import { app, errorHandler } from 'mu';
import fetch from 'node-fetch';
import { CronJob } from 'cron';
import {
  createJob,
  getNextScheduledJob,
  getJob,
  executeJob,
  getSummary,
  getFailedJobs,
  incrementJobRetryCount,
} from './support/jobs';
import { fetchScheduledPublicationActivities } from './support/polling';
import sq from './support/sparql-queries';
import config from './config';

/** Schedule publications from Kaleidos cron job */
const cronFrequency = process.env.PUBLICATION_CRON_PATTERN || '0 * * * * *';

new CronJob(cronFrequency, function() {
  console.log(`Kaleidos publication polling triggered by cron job at ${new Date().toISOString()}`);
  triggerKaleidosPublications();
  console.log(`Retrying failed PublicExportJobs triggered by cron job at ${new Date().toISOString()}`);
  retriggerFailedExportJobs();
}, null, true);

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
 *       "scope": ["newsitems", "documents"],
 *       "source": "http://themis.vlaanderen.be/publicatie-activiteit/326ca29e-896d-4231-9a72-0be237e104fb"
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

  const source = req.body.data && req.body.data.attributes && req.body.data.attributes.source;
  if (source) {
    try {
      new URL(source);
    } catch (e) {
      return res.status(400).send({ error: 'Invalid source URI' });
    }
  }

  const meeting = await sq.getMeeting({ id: meetingId });
  if (meeting) {
    const job = await createJob(meeting.uri, scope, source);
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

async function triggerKaleidosPublications() {
  const publicationActivities = await fetchScheduledPublicationActivities();
  if (publicationActivities.length) {
    console.log(`Found ${publicationActivities.length} new publication activities in Kaleidos`);
    for (let publicationActivity of publicationActivities) {
      console.log(`Trigger publication for meeting <${publicationActivity.meeting.uri}>, planned at ${publicationActivity.plannedStart}`);
      const response = await fetch(`http://localhost/meetings/${publicationActivity.meeting.id}/publication-activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          data: {
            type: 'publication-activity',
            attributes: {
              scope: publicationActivity.scope,
              source: publicationActivity.uri
            }
          }
        })
      });
      if (!response.ok) {
        console.log(`Something went wrong while triggering publication for meeting <${publicationActivity.meeting.uri}>`);
        const error = await response.json();
        console.log(error);
      }
    }
  } else {
    console.log(`Nothing to publish right now.`);
  }
}

async function retriggerFailedExportJobs() {
  const failedJobs = await getFailedJobs();
  console.debug(failedJobs);
  for (let job of failedJobs) {
    if (job.retryCount < config.export.job.maxRetryCount) {
      console.log(
        `Retrying failed job <${job.uri}>... [${job.retryCount + 1}/${config.export.job.maxRetryCount}]`
      );
      await incrementJobRetryCount(job.uri, job.retryCount);
      await executeJob(job);
    }
  }
}
