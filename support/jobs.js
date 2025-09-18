import { sparqlEscapeString, sparqlEscapeUri, sparqlEscapeDateTime, sparqlEscapeInt, uuid } from 'mu';
import { querySudo as query, updateSudo as update } from '@lblod/mu-auth-sudo';
import { generateExport } from './export';
import config from '../config';

class JobManager {
  constructor() {
    this.isExecuting = false;
  }

  async run() {
    if (this.isExecuting) {
      return;
    }

    let hasRun = false;
    try {
      this.isExecuting = true;
      const job = await getNextScheduledJob();
      if (job) {
        console.debug(`Found next scheduled job <${job.uri}>, executing...`);
        await executeJob(job);
        hasRun = true;
      } else {
        console.debug('No job found in current execution of JobManager#run');
      }
    } catch (error) {
      console.log(`Unexpected error was raised during execution of job: ${error}`);
      console.trace(error);
    } finally {
      this.isExecuting = false;
      if (hasRun) {
        // If we found a scheduled job this run, re-trigger in case there's more
        // Otherwise we just wait until we get triggered by the poll-rate
        this.run();
      }
    }
  }
}

async function createJob(meeting, scopes, source = null) {
  const jobUuid = uuid();
  const jobUri = `http://data.kaleidos.vlaanderen.be/public-export-jobs/${jobUuid}`;

  const scopeStatements = (scopes || []).map((scope) => (
    `${sparqlEscapeUri(jobUri)} ext:scope ${sparqlEscapeString(scope)} .`
  ));

  const sourceStatement = source ? `${sparqlEscapeUri(jobUri)} dct:source ${sparqlEscapeUri(source)} .` : '';

  const now = new Date();

  console.log(`Creating job with uri ${sparqlEscapeUri(jobUri)} for meeting ${sparqlEscapeUri(meeting)}`);
  await update(`
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX prov: <http://www.w3.org/ns/prov#>
  PREFIX adms: <http://www.w3.org/ns/adms#>

  INSERT DATA {
    GRAPH <${config.export.graphs.job}> {
        ${sparqlEscapeUri(jobUri)} a ${sparqlEscapeUri(config.export.job.rdfType)} ;
                           mu:uuid ${sparqlEscapeString(jobUuid)} ;
                           prov:used ${sparqlEscapeUri(meeting)} ;
                           adms:status ${sparqlEscapeUri(config.export.job.statuses.scheduled)} ;
                           dct:created ${sparqlEscapeDateTime(now)} .
        ${scopeStatements.join('\n')}
        ${sourceStatement}
    }
  }`);

  return {
    id: jobUuid,
    uri: jobUri
  };
}

async function getNextScheduledJob() {
  const result = await query(`
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX prov: <http://www.w3.org/ns/prov#>
  PREFIX adms: <http://www.w3.org/ns/adms#>

  SELECT ?uri ?id ?meeting ?retryCount
  WHERE {
    GRAPH <${config.export.graphs.job}> {
      VALUES ?status {
        ${sparqlEscapeUri(config.export.job.statuses.scheduled)}
        ${sparqlEscapeUri(config.export.job.statuses.failed)}
      }
      ?uri a ${sparqlEscapeUri(config.export.job.rdfType)} ;
           mu:uuid ?id ;
           dct:created ?created ;
           prov:used ?meeting ;
           adms:status ?status .
      OPTIONAL { ?uri ext:retryCount ?maybeRetryCount }
      BIND(IF(BOUND(?maybeRetryCount), ?maybeRetryCount, 0) AS ?retryCount)
      FILTER (?retryCount < ${sparqlEscapeInt(config.export.job.maxRetryCount)})
      FILTER NOT EXISTS {
        ?job a ${sparqlEscapeUri(config.export.job.rdfType)} ;
           adms:status ${sparqlEscapeUri(config.export.job.statuses.busy)} .
      }
    }
  } ORDER BY ASC(?created) LIMIT 1`);

  const bindings = result.results.bindings;
  if (bindings.length == 1) {
    return {
      id: bindings[0]['id'].value,
      uri: bindings[0]['uri'].value,
      meeting: bindings[0]['meeting'].value,
      retryCount: parseInt(bindings[0]['retryCount'].value),
    };
  } else {
    return null;
  }
}

async function getJob(uuid) {
  const result = await query(`
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX prov: <http://www.w3.org/ns/prov#>
  PREFIX adms: <http://www.w3.org/ns/adms#>

  SELECT ?uri ?created ?meeting ?status
  WHERE {
    GRAPH <${config.export.graphs.job}> {
      ?uri a ${sparqlEscapeUri(config.export.job.rdfType)} ;
           mu:uuid ${sparqlEscapeString(uuid)} ;
           dct:created ?created ;
           prov:used ?meeting ;
           adms:status ?status .
    }
  } LIMIT 1`);

  const bindings = result.results.bindings;
  if (bindings.length == 1) {
    return {
      id: uuid,
      uri: bindings[0]['uri'].value,
      meeting: bindings[0]['meeting'].value,
      created: bindings[0]['created'].value,
      status: bindings[0]['status'].value,
    };
  } else {
    return null;
  }
}

async function executeJob(job) {
  try {
    await updateJobStatus(job.uri, config.export.job.statuses.busy);
    const result = await query(`
    PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>

    SELECT ?scope
    WHERE {
      GRAPH <${config.export.graphs.job}> {
        ${sparqlEscapeUri(job.uri)} ext:scope ?scope .
      }
    }`);

    if (result.results.bindings.length) {
      job.scope = result.results.bindings.map(b => b['scope'].value);
    } else {
      job.scope = [];
    }

    const timestamp = new Date().toISOString().replace(/\D/g, '');
    job.graph = config.export.graphs.tmp(timestamp);

    await setGeneratedResource(job.uri, job.graph);
    const publicationActivity = await generateExport(job);
    if (publicationActivity)
      await setGeneratedResource(job.uri, publicationActivity);
    await updateJobStatus(job.uri, config.export.job.statuses.success);
    console.log(`Successfully finished job <${job.uri}>`);
  } catch (e) {
    console.log(
      `Execution of job <${job.uri}> failed [tries: ${job.retryCount + 1}/${config.export.job.maxRetryCount}]: ${e}`
    );
    console.trace(e);
    // TODO message on fail? we could check this in frontend maybe?
    await updateJobStatus(job.uri, config.export.job.statuses.failed);
    await incrementJobRetryCount(job.uri, job.retryCount);
  }
}

async function getSummary() {
  const result = await query(`
    PREFIX adms: <http://www.w3.org/ns/adms#>

    SELECT ?status (COUNT(?s) as ?count) WHERE {
      GRAPH <${config.export.graphs.job}> {
        ?s a ${sparqlEscapeUri(config.export.job.rdfType)} ;  adms:status ?status .
      }
    } GROUP BY ?status`);

  return result.results.bindings.map(b => { return { status: b['status'].value, count: parseInt(b['count'].value) }; });
}

async function updateJobStatus(uri, status, errorMessage) {
  let timePred;
  if (status === JOB.STATUSES.SUCCESS || status === JOB.STATUSES.FAILED) {
    timePred = 'http://www.w3.org/ns/prov#endedAtTime';
  } else {
    timePred = 'http://www.w3.org/ns/prov#startedAtTime';
  }
  await update(`
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX adms: <http://www.w3.org/ns/adms#>

  DELETE {
    GRAPH <${config.export.graphs.job}> {
      ${sparqlEscapeUri(uri)} adms:status ?status .
      ${sparqlEscapeUri(uri)} ${sparqlEscapeUri(timePred)} ?time .
    }
  } WHERE {
    GRAPH <${config.export.graphs.job}> {
      ${sparqlEscapeUri(uri)} adms:status ?status .
      OPTIONAL {
        ${sparqlEscapeUri(uri)} ${sparqlEscapeUri(timePred)} ?time .
      }
    }
  }

  ;

  INSERT DATA {
    GRAPH <${config.export.graphs.job}> {
        ${sparqlEscapeUri(uri)} ${sparqlEscapeUri(timePred)} ${sparqlEscapeDateTime(new Date())} ;
        ${errorMessage ? `schema:error ${sparqlEscapeString(errorMessage)} ;` : ""}
             adms:status ${sparqlEscapeUri(status)}.
    }
  }`);
}


async function setGeneratedResource(uri, resource) {
  await update(`
  PREFIX prov: <http://www.w3.org/ns/prov#>

  INSERT DATA {
    GRAPH <${config.export.graphs.job}> {
        ${sparqlEscapeUri(uri)} prov:generated ${sparqlEscapeUri(resource)}.
    }
  }`);
}

async function incrementJobRetryCount(uri, retryCount) {
  await update(`
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  DELETE WHERE {
    GRAPH <${config.export.graphs.job}> {
      ${sparqlEscapeUri(uri)} ext:retryCount ?retryCount .
    }
  }`);

  await update(`
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  INSERT DATA {
    GRAPH <${config.export.graphs.job}> {
      ${sparqlEscapeUri(uri)} ext:retryCount ${sparqlEscapeInt(retryCount + 1)}
    }
  }`);
}

export {
  JobManager,
  createJob,
  getJob,
  getSummary,
};
