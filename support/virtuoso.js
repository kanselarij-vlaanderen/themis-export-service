import httpContext from 'express-http-context';
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

function queryVirtuoso(queryString) {
  if (LOG_VIRTUOSO_QUERIES)
    console.log(queryString);
  return virtuosoSparqlClient().query(queryString).executeRaw().then(response => {
    function maybeParseJSON(body) {
      // Catch invalid JSON
      try {
        return JSON.parse(body);
      } catch (ex) {
        return null;
      }
    }

    return maybeParseJSON(response.body);
  });
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
