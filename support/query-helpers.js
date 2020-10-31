import request from 'request';
import { sparqlEscapeUri } from 'mu';
import { updateVirtuoso as update } from './virtuoso';

/**
 * Convert results of select query to an array of objects.
 * @method parseResult
 * @return {Array}
 */
function parseResult(result) {
  const bindingKeys = result.head.vars;
  return result.results.bindings.map((row) => {
    const obj = {};
    bindingKeys.forEach((key) => {
      if (row[key]) {
        obj[key] = row[key].value;
      } else {
        obj[key] = null;
      }
    });
    return obj;
  });
}

/**
 * Executes a CONSTRUCT query on Kaleidos and inserts the resulting triples
 * in a given graph of the internal triple store.
 *
 * @param [string} query Construct query to execute on the Kaleidos triple store
 * @param {string} graph URI of the graph to insert the resulting triples in
*/
async function copyToLocalGraph(query, graph) {
  try {
    const triples = await constructTriples(query);
    if (!triples.includes('# Empty NT')) { // TODO check in a structured way whether the response doesn't contain triples
      const insertQuery = `
        INSERT DATA {
          GRAPH ${sparqlEscapeUri(graph)} {
            ${triples}
          }
        }
      `;
      await update(insertQuery);
    }
  } catch (e) {
    console.log(`Something went wrong while executing query: ${query}. Nothing inserted in the store.`);
    console.log(e);
    throw e;
  }
}

async function constructTriples(query) {
  const format = 'text/plain'; // N-triples format
  const options = {
    method: 'POST',
    url: process.env.KALEIDOS_SPARQL_ENDPOINT,
    headers: {
      'Accept': format
    },
    qs: {
      format: format,
      query: query
    }
  };

  return new Promise ( (resolve,reject) => {
    return request(options, function(error, response, body) {
      if (error)
        reject(error);
      else
        resolve(body);
    });
  });

}

export {
  copyToLocalGraph,
  parseResult
};
