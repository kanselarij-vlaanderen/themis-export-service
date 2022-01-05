import { app, errorHandler } from 'mu';
import { createJob, getNextScheduledJob, getJob, executeJob, getSummary } from './support/jobs';
import sq from './support/sparql-queries';

/**
 * Endpoint to trigger the publication of a meeting from Kaleidos
 *
 * Path variable :uuid is the uuid of the meeting to be exported from Kaleidos
 * Request body specifies the scope of the export: newsitems and/or documents.
 * E.g.
 * {
 *   "data": {
 *     "type": "publication-activity",
 *     "attributes": {
 *       "scope": ['newsitems', 'documents']
 *     }
 *   }
 * }
*/
app.post('/meetings/:uuid/publication-activities', async function(req, res) {
  const meetingId = req.params.uuid;
  console.log(`Received request: ${JSON.stringify(req.body)}`);
  const scope = req.body.data && req.body.data.attributes && req.body.data.attributes.scope;
  if (scope && scope.includes('documents') && !scope.includes('newsitems')) {
    return res.status(400).send({
      error: 'If "documents" is included in the scope "newsitems" also need to be included.'
    });
  }

  const meeting = await sq.getMeeting({ id: meetingId });
  if (meeting) {
    const job = await createJob(meeting.uri, scope);
    executeJobs(); // async execution of export job
    return res.status(202).location(`/public-export-jobs/${job.id}`).send();
  } else {
    return res.status(404).send(
      { error: `Could not find meeting with uuid ${meetingId} in Kaleidos`}
    );
  }
});

app.get('/public-export-jobs/summary', async function(req, res) {
  const summary = await getSummary();
  return res.status(200).send({
    data: summary
  });
});

app.get('/public-export-jobs/:uuid', async function(req, res) {
  const job = await getJob(req.params.uuid);
  if (job) {
    return res.status(200).send({
      data: {
        type: 'public-export-job',
        id: job.id,
        attributes: {
          uri: job.uri,
          meeting: job.meeting,
          status: job.status,
          created: job.created
        }
      }
    });
  } else {
    return res.status(404).send(
      { error: `Could not find public-export-job with uuid ${req.params.uuid}`}
    );
  }
});

app.use(errorHandler);

executeJobs();

async function executeJobs() {
  const job = await getNextScheduledJob();
  if (job) {
    await executeJob(job);
    executeJobs(); // trigger execution of next job if there is one scheduled
  }
  // else: no job scheduled. Nothing should happen
}
