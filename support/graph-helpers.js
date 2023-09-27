import fs from 'fs-extra';
import request from 'request';
import { sparqlEscapeUri } from 'mu';
// All intermediate data is written directly to Virtuoso in order to not generate delta notifications for these data insertions
// Virtuoso is just used here as a temporary store to gather data before writing it to a file
import { querySudo } from '@lblod/mu-auth-sudo';
import { queryVirtuoso } from './virtuoso';
import config from '../config';

const batchSize = parseInt(process.env.EXPORT_BATCH_SIZE) || 1000;

/**
 * Write all triples of a graph to a file in Turtle format.
 *
 * @param {string} graph URI of the graph to export
 * @param {string} file Absolute path of the file to export to (e.g. /data/exports/my-graph.ttl)
 *
 * @return {int} Number of triples written to the file
*/
async function writeToFile(graph, file, targetGraph = config.export.graphs.public) {
  const tmpFile = `${file}.tmp`;

  const count = await countTriples(graph);
  console.log(`Exporting 0/${count} triples from graph <${graph}>`);

  if (count > 0) {
    let offset = 0;
    const query = `
      CONSTRUCT {
        ?s ?p ?o
      }
      WHERE {
        GRAPH ${sparqlEscapeUri(graph)} {
          ?s ?p ?o .
        }
      }
      LIMIT ${batchSize} OFFSET %OFFSET
    `;

    while (offset < count) {
      await appendBatch(tmpFile, query, offset);
      offset = offset + batchSize;
      console.log(`Constructed ${offset < count ? offset : count}/${count} triples from graph <${graph}>`);
    }

    await fs.rename(tmpFile, file);
    const graphFile = file.replace('.ttl', '.graph');
    await fs.writeFile(graphFile, targetGraph);
  }

  return count;
}

async function countTriples(graph) {
  const queryResult = await querySudo(`
      SELECT (COUNT(*) as ?count)
      WHERE {
        GRAPH ${sparqlEscapeUri(graph)} {
          ?s ?p ?o .
        }
      }
    `);

  return parseInt(queryResult.results.bindings[0].count.value);
}

async function appendBatch(file, query, offset = 0) {
  const format = 'text/turtle';
  const options = {
    method: 'POST',
    url: config.endpoints.virtuoso,
    headers: {
      'Accept': format
    },
    qs: {
      format: format,
      query: query.replace('%OFFSET', offset)
    }
  };

  return new Promise ( (resolve,reject) => {
    const writer = fs.createWriteStream(file, { flags: 'a' });
    try {
      writer.on('finish', resolve);
      return request(options)
        .on('error', (error) => { reject(error); })
        .on('end', () => { writer.end("\n"); })
        .pipe(writer, { end: false });
    }
    catch(e) {
      writer.end();
      return reject(e);
    }
  });
}

async function add(source, target) {
  await queryVirtuoso(`ADD SILENT GRAPH <${source}> TO <${target}>`);
}

async function clean(graph) {
  await queryVirtuoso(`DEFINE sql:log-enable 3 DROP SILENT GRAPH <${graph}>`);
}

export {
  writeToFile,
  add,
  clean
};
