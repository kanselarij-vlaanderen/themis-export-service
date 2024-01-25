import { sparqlEscapeUri, sparqlEscapeDateTime } from 'mu';
import { parseResult } from './query-helpers';
import config from '../config.js';

/**
 * Fetch all publication-activities in Kaleidos with a planned start date
 * in the past (within in a limited window) that are not yet published
*/
async function fetchScheduledPublicationActivities() {
  const publicationActivities = await getRecentPublicationActivities();
  const unpublishedActivities = [];
  for (let publicationActivity of publicationActivities) {
    publicationActivity.scope = await getScope(publicationActivity.uri);
    unpublishedActivities.push(publicationActivity);
  }
  return unpublishedActivities;
}

/**
 * Get all themis-publication-activities that have a planned start in a limited window.
 * We only get those that have a startedAtTime and a status of "released" 
 */
async function getRecentPublicationActivities() {
  const now = new Date();
  const publicationWindowStart = new Date(now.getTime() - config.kaleidos.publication.window);

  const result = await query(`
    PREFIX prov: <http://www.w3.org/ns/prov#>
    PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX adms: <http://www.w3.org/ns/adms#>
    PREFIX dct: <http://purl.org/dc/terms/>

    SELECT ?uri ?meeting ?meetingId ?plannedStart
    WHERE {
      GRAPH ${sparqlEscapeUri(config.kaleidos.graphs.kanselarij)} {
        ?uri a ext:ThemisPublicationActivity ;
          prov:used ?meeting ;
          prov:startedAtTime ?plannedStart ;
          adms:status ?status .
        FILTER(?status = ${sparqlEscapeUri(config.kaleidos.releaseStatuses.released)})
        FILTER(?plannedStart >= ${sparqlEscapeDateTime(publicationWindowStart)})
        FILTER(?plannedStart <= ${sparqlEscapeDateTime(now)})
        ?meeting mu:uuid ?meetingId .
      }
      GRAPH ${sparqlEscapeUri(config.export.graphs.job)} {
        FILTER NOT EXISTS { ?job a ext:PublicExportJob ; dct:source ?uri }
      }
    } ORDER BY ?plannedStart
  `);

  const publicationActivities = result.results.bindings.map((b) => {
    return {
      uri: b['uri'].value,
      meeting: {
        uri: b['meeting'].value,
        id: b['meetingId'].value
      },
      plannedStart: b['plannedStart'].value
    };
  });

  return publicationActivities;
}

async function getScope(publicationActivity) {
  const scope = parseResult(await query(`
    PREFIX prov: <http://www.w3.org/ns/prov#>
    PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
    SELECT ?label
    WHERE {
      GRAPH ${sparqlEscapeUri(config.kaleidos.graphs.kanselarij)} {
        ${sparqlEscapeUri(publicationActivity)} a ext:ThemisPublicationActivity ;
          ext:scope ?label .
      }
    }
  `));

  return scope.map(s => s.label);
}

export {
  fetchScheduledPublicationActivities
};
