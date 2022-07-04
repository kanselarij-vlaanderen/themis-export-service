import { querySudo as query } from '@lblod/mu-auth-sudo';
import { sparqlEscapeUri, sparqlEscapeDateTime } from 'mu';
import { queryKaleidos } from './kaleidos';
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
    const isPublished = await hasBeenPublished(publicationActivity.uri);
    if (!isPublished) {
      publicationActivity.scope = await getScope(publicationActivity.uri);
      unpublishedActivities.push(publicationActivity);
    }
  }
  return unpublishedActivities;
}

async function hasBeenPublished(publicationActivity) {
  const jobs = parseResult(await query(`
      PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
      PREFIX dct: <http://purl.org/dc/terms/>

      SELECT ?uri
      WHERE {
        GRAPH <${config.export.graphs.job}> {
          ?uri a ext:PublicExportJob ;
            dct:source ${sparqlEscapeUri(publicationActivity)} .
        }
      } LIMIT 1
    `));

  return jobs.length != 0;
}

async function getRecentPublicationActivities() {
  const now = new Date();
  const publicationWindowStart = new Date(now.getTime() - config.kaleidos.publication.window);

  const result = await queryKaleidos(`
    PREFIX prov: <http://www.w3.org/ns/prov#>
    PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>

    SELECT ?uri ?meeting ?meetingId ?plannedStart
    WHERE {
      GRAPH ${sparqlEscapeUri(config.kaleidos.graphs.kanselarij)} {
        ?uri a ext:ThemisPublicationActivity ;
          prov:used ?meeting ;
          prov:startedAtTime ?plannedStart .
        FILTER(?plannedStart >= ${sparqlEscapeDateTime(publicationWindowStart)})
        FILTER(?plannedStart <= ${sparqlEscapeDateTime(now)})
        ?meeting mu:uuid ?meetingId .
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
  const scope = parseResult(await queryKaleidos(`
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
