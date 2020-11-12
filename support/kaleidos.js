import httpContext from 'express-http-context';
import SC2 from 'sparql-client-2';
const { SparqlClient } = SC2;

const kaleidosSparqlEndpoint = process.env.KALEIDOS_SPARQL_ENDPOINT || "http://kaleidos:8890/sparql";
const LOG_KALEIDOS_QUERIES = [true, 'true', 1, '1', 'yes', 'Y', 'on'].includes(process.env.LOG_KALEIDOS_QUERIES);

function kaleidosSparqlClient() {
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

  return new SparqlClient(kaleidosSparqlEndpoint, options);
}

function queryKaleidos(queryString) {
  if (LOG_KALEIDOS_QUERIES)
    console.log(queryString);
  return kaleidosSparqlClient().query(queryString).executeRaw().then(response => {
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

const exports = {
  queryKaleidos
};

export default exports;

export {
  queryKaleidos
};
