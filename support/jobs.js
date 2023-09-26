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
      const job = await getNextScheduledJob()
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

  await update(`
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX prov: <http://www.w3.org/ns/prov#>
  PREFIX adms: <http://www.w3.org/ns/adms#>

  INSERT DATA {
    GRAPH <${config.export.graphs.job}> {
        ${sparqlEscapeUri(jobUri)} a ext:PublicExportJob ;
                           mu:uuid ${sparqlEscapeString(jobUuid)} ;
                           prov:used ${sparqlEscapeUri(meeting)} ;
                           adms:status ${sparqlEscapeUri(config.export.job.statuses.scheduled)} ;
                           dct:created ${sparqlEscapeDateTime(now)} ;
                           dct:modified ${sparqlEscapeDateTime(now)} .
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

  SELECT ?uri ?id ?meeting
  WHERE {
    GRAPH <${config.export.graphs.job}> {
      ?uri a ext:PublicExportJob ;
           mu:uuid ?id ;
           dct:created ?created ;
           prov:used ?meeting ;
           adms:status ${sparqlEscapeUri(config.export.job.statuses.scheduled)} .
      FILTER NOT EXISTS {
        ?job a ext:PublicExportJob ;
           adms:status ${sparqlEscapeUri(config.export.job.statuses.ongoing)} .
      }
    }
  } ORDER BY ASC(?created) LIMIT 1`);

  const bindings = result.results.bindings;
  if (bindings.length == 1) {
    return {
      id: bindings[0]['id'].value,
      uri: bindings[0]['uri'].value,
      meeting: bindings[0]['meeting'].value
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
      ?uri a ext:PublicExportJob ;
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
    await updateJobStatus(job.uri, config.export.job.statuses.ongoing);
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
    console.log(`Execution of job <${job.uri}> failed: ${e}`);
    console.trace(e);
    await updateJobStatus(job.uri, config.export.job.statuses.failure);
  }
}

async function getSummary() {
  const result = await query(`
    SELECT ?status (COUNT(?s) as ?count) WHERE {
      GRAPH <http://mu.semte.ch/graphs/kaleidos-export> {
        ?s a <http://mu.semte.ch/vocabularies/ext/PublicExportJob> ;  <http://www.w3.org/ns/adms#status> ?status .
      }
    } GROUP BY ?status`);

  return result.results.bindings.map(b => { return { status: b['status'].value, count: parseInt(b['count'].value) }; });
}

async function updateJobStatus(uri, status) {
  await update(`
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX adms: <http://www.w3.org/ns/adms#>

  DELETE WHERE {
    GRAPH <${config.export.graphs.job}> {
        ${sparqlEscapeUri(uri)} dct:modified ?modified ;
             adms:status ?status.
    }
  }

  ;

  INSERT DATA {
    GRAPH <${config.export.graphs.job}> {
        ${sparqlEscapeUri(uri)} dct:modified ${sparqlEscapeDateTime(new Date())};
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

async function getFailedJobs() {
  const result = await query(`
    PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
    PREFIX adms: <http://www.w3.org/ns/adms#>
    PREFIX prov: <http://www.w3.org/ns/prov#>
    SELECT ?uri ?meetingUri ?retryCount WHERE {
      GRAPH ${sparqlEscapeUri(config.export.graphs.job)} {
        ?uri a ext:PublicExportJob ;
             prov:used ?meetingUri ;
             adms:status ${sparqlEscapeUri(config.export.job.statuses.failure)} .
        OPTIONAL { ?uri ext:retryCount ?retryCount }
      }
    }`);

  return result
    .results.bindings
    .map(b => ({
      uri: b['uri'].value,
      meeting: b['meetingUri'].value,
      retryCount: parseInt(b['retryCount']?.value ?? 0),
    }));
}

async function incrementJobRetryCount(uri, retryCount) {
  if (retryCount) {
    await update(`
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  DELETE DATA {
    GRAPH <${config.export.graphs.job}> {
      ${sparqlEscapeUri(uri)} ext:retryCount ${sparqlEscapeInt(retryCount)}
    }
  }`);
  }

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
  getNextScheduledJob,
  getJob,
  executeJob,
  getSummary,
  getFailedJobs,
  incrementJobRetryCount,
};
