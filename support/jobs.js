import { sparqlEscapeString, sparqlEscapeUri, sparqlEscapeDateTime, uuid } from 'mu';
import { querySudo as query, updateSudo as update } from '@lblod/mu-auth-sudo';
import { parseResult } from './query-helpers';
import { generateExport } from './export';
import config from '../config';

async function createJob(meeting, scopes) {
  const jobUuid = uuid();
  const jobUri = `http://data.kaleidos.vlaanderen.be/public-export-jobs/${jobUuid}`;

  const scopeStatements = (scopes || []).map((scope) => (
    `${sparqlEscapeUri(jobUri)} ext:scope ${sparqlEscapeString(scope)}.`
  ));

  const now = new Date();

  await update(`
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX prov: <http://www.w3.org/ns/prov#>
  PREFIX adms: <http://www.w3.org/ns/adms#>

  INSERT DATA {
    GRAPH <${config.export.graphs.job}> {
        ${sparqlEscapeUri(jobUri)} a ext:PublicExportJob;
                           mu:uuid ${sparqlEscapeString(jobUuid)} ;
                           prov:used ${sparqlEscapeUri(meeting)} ;
                           adms:status ${sparqlEscapeUri(config.export.job.statuses.scheduled)} ;
                           dct:created ${sparqlEscapeDateTime(now)} ;
                           dct:modified ${sparqlEscapeDateTime(now)} .
        ${scopeStatements.join('\n')}
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

    await updateJobStatus(job.uri, config.export.job.statuses.ongoing);
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

export {
  createJob,
  getNextScheduledJob,
  executeJob
}
