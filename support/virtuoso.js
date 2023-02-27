import httpContext from 'express-http-context';
import SC2 from 'sparql-client-2';
import config from '../config';

const { SparqlClient } = SC2;

const LOG_VIRTUOSO_QUERIES = [true, 'true', 1, '1', 'yes', 'Y', 'on'].includes(process.env.LOG_VIRTUOSO_QUERIES);
const NB_OF_QUERY_RETRIES = parseInt(process.env.NB_OF_VIRTUOSO_QUERY_RETRIES || 6);
const RETRY_TIMEOUT_MS = parseInt(process.env.VIRTUOSO_QUERY_RETRY_MILLIS || 1000);

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

  return new SparqlClient(config.endpoints.virtuoso, options);
}

async function executeQuery(client, queryString, options = { }) {
  const retries = options.retries || NB_OF_QUERY_RETRIES;

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
      const current = NB_OF_QUERY_RETRIES - retriesLeft;
      const timeout = current * RETRY_TIMEOUT_MS;
      console.log(`Failed to execute query (attempt ${current} out of ${NB_OF_QUERY_RETRIES}). Will retry.`);
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
