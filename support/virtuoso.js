import httpContext from 'express-http-context';
import config from '../config';
import SC2 from 'sparql-client-2';
const { SparqlClient } = SC2;

const virtuosoSparqlEndpoint = process.env.VIRTUOSO_SPARQL_ENDPOINT || "http://virtuoso:8890/sparql";
const LOG_VIRTUOSO_QUERIES = [true, 'true', 1, '1', 'yes', 'Y', 'on'].includes(process.env.LOG_VIRTUOSO_QUERIES);

function virtuosoSparqlClient() {
  let options = {
    requestDefaults: {
      headers: {
      }
    }
  };

  if (httpContext.get('request')) {
    options.requestDefaults.headers['mu-session-id'] = httpContext.get('request').get('mu-session-id');
    options.requestDefaults.headers['mu-call-id'] = httpContext.get('request').get('mu-call-id');
  }

  return new SparqlClient(virtuosoSparqlEndpoint, options);
}

async function executeQuery(client, queryString, options = { }) {
  const retries = options.retries || config.numberOfQueryRetries;

  try {
    const response = await client.query(queryString).executeRaw();

    function maybeParseJSON(body) {
      try {
        return JSON.parse(body);
      } catch (ex) { // Catch invalid JSON
        return null;
      }
    }

    return maybeParseJSON(response.body);
  } catch (ex) {
    const retriesLeft = retries - 1;
    if (retriesLeft > 0) {
      const current = config.numberOfQueryRetries - retriesLeft;
      const timeout = current * config.retryTimeoutMilliseconds;
      console.log(`Failed to execute query (attempt ${current} out of ${config.numberOfQueryRetries}). Will retry.`);
      return new Promise(function(resolve, reject) {
        setTimeout(() => {
          try {
            const result = executeQuery(client, queryString, { retries: retriesLeft });
            resolve(result);
          } catch (ex) {
            reject(ex);
          }
        }, timeout);
      });
    } else {
      console.log(`Max number of retries reached. Query failed.\n ${queryString}`);
      throw ex;
    }
  }
}

async function queryVirtuoso(queryString) {
  if (LOG_VIRTUOSO_QUERIES)
    console.log(queryString);
  const client = virtuosoSparqlClient();
  return await executeQuery(client, queryString);
}

const updateVirtuoso = queryVirtuoso;

const exports = {
  queryVirtuoso,
  updateVirtuoso
};

export default exports;

export {
  queryVirtuoso,
  updateVirtuoso
};
