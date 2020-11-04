import { sparqlEscapeUri, uuid } from 'mu';
import { querySudo as query, updateSudo as update } from '@lblod/mu-auth-sudo';
import groupBy from 'lodash.groupby';
import uniq from 'lodash.uniq';
import config from '../config';
import sq from './sparql-queries';
import { writeToFile, clean as cleanGraph, add as addGraph } from './graph-helpers';

async function generateExport(job) {
  if (job.scope && job.scope.length) {
    const meeting = await sq.getMeeting({ uri: job.meeting });
    const meetingDate = new Date(Date.parse(meeting.geplandeStart));
    console.log(`Generating export for meeting <${job.meeting}> of ${meetingDate} with scope ${JSON.stringify(job.scope)}`);

    if (meetingDate < config.export.historicDates.newsitems) {
      console.log(`Public export didn't exist yet on ${meetingDate}. Nothing will be exported.`);
      return null;
    }

    const timestamp = new Date().toISOString().replace(/\D/g, '');

    await sq.copyMeeting(job.meeting, job.graph);

    const includeAnnouncements = meetingDate >= config.export.historicDates.announcements;
    if (!includeAnnouncements) {
      console.log(`Public export didn't include announcements yet on ${meetingDate}. Announcements will not be exported.`);
    }
    const publicResources = await generatePublicAgendaAndAgendaitems(job.meeting, includeAnnouncements, job.graph);

    if (job.scope.includes("newsitems")) {
      publicResources.newsitems = await copyNewsitems(publicResources.agendaitems, job.graph);
    }

    if (job.scope.includes("documents")) {
      if (meetingDate < config.export.historicDates.documents) {
        console.log(`Public export didn't include documents yet on ${meetingDate}. Documents will not be exported.`);
      } else {
        await copyDocuments(publicResources.newsitems, job.graph);
      }
    }

    const meetingTimestamp = meetingDate.toISOString().replace(/\D/g, '');
    const filename = `${timestamp.substring(0, 14)}-${timestamp.slice(14)}-${job.id}-${meetingTimestamp}.ttl`;
    const file = `${config.export.directory}${filename}`;
    await writeToFile(job.graph, file);
    await addGraph(job.graph, config.export.graphs.public); // publication activity data is required for next runs
    await cleanGraph(job.graph);
    await createTtlToDeltaTask([file]);
    return publicResources.publicationActivity.uri;
  } else {
    console.log(`No export scope provided for job <${job.uri}>. Nothing to export.`);
    return null;
  }
}

async function generatePublicAgendaAndAgendaitems(meeting, includeAnnouncements, graph) {
  const publication = await sq.insertPublicationActivity(meeting, graph);
  const previousPublication = await sq.getPreviousPublicationActivity(meeting);
  const previousPublicationUri = previousPublication ? previousPublication.uri : null;
  if (previousPublicationUri)
    console.log(`Found a previous publication activity <${previousPublicationUri}> for this meeting`);

  const agenda = await sq.getLatestAgendaOfMeeting(meeting);
  console.log(`Latest agenda found is agenda ${agenda.serialNumber} (<${agenda.uri}>). This agenda will be used as basis for the export.`);

  const publicAgenda = await sq.insertPublicAgenda(agenda, meeting, publication.uri, previousPublicationUri, graph);
  let agendaitems = await sq.getAgendaitemsWithNewsletterInfo(agenda);
  if (!includeAnnouncements)
    agendaitems = agendaitems.filter(item => item.isAnnouncement != "true");
  console.log(`Found ${agendaitems.length} agendaitems with a newsitem to publish`);
  const sortedAgendaitems = sortAgendaitems(agendaitems);

  const publicAgendaitems = await sq.insertPublicAgendaitems(sortedAgendaitems, publicAgenda, publication.uri, previousPublicationUri, graph);

  console.log(`Public agenda <${publicAgenda.uri}>`);
  console.log('-----------------------------------');
  publicAgendaitems.forEach(item => console.log(`[${item.number}] ${item.shortTitle} (${item.kaleidosUri})`));
  console.log('-----------------------------------');

  return {
    publicationActivity: publication,
    agenda: publicAgenda,
    agendaitems: publicAgendaitems
  };
}

function sortAgendaitems(agendaitems) {
  const notas = agendaitems.filter(item => item.isAnnouncement == "false");
  const announcements = agendaitems.filter(item => item.isAnnouncement == "true");

  console.log(`Publication includes ${notas.length} notas and ${announcements.length} announcements`);

  const sortedNotas = notas.sort(function(a, b) { return a.number - b.number; });
  const sortedAnnouncements = announcements.sort(function(a, b) { return a.number - b.number; });

  sortedNotas.forEach(item => item.type = config.export.codelists.agendaitemType.nota);
  sortedAnnouncements.forEach(item => item.type = config.export.codelists.agendaitemType.announcement);

  if (sortedNotas.length) {
    sortedNotas[0].previousAgendaitem = null;
    sortedNotas[0].number = 1;
  }
  for (let i = 1; i < sortedNotas.length; i++) {
    sortedNotas[i].previousAgendaitem = sortedNotas[i - 1].uri;
    sortedNotas[i].number = i + 1;
  }

  if (sortedAnnouncements.length) {
    sortedAnnouncements[0].previousAgendaitem = sortedNotas.length ? sortedNotas[sortedNotas.length - 1].uri : null;
    sortedAnnouncements[0].number = 1;
  }
  for (let i = 1; i < sortedAnnouncements.length; i++) {
    sortedAnnouncements[i].previousAgendaitem = sortedAnnouncements[i - 1].uri;
    sortedAnnouncements[i].number = i + 1;
  }

  return [...sortedNotas, ...sortedAnnouncements];
}

async function copyNewsitems(agendaitems, graph) {
  let newsitems = [];
  for (let agendaitem of agendaitems) {
    const newsitem = await sq.getNewsitem(agendaitem.newsletterInfo, agendaitem.kaleidosUri);
    newsitem.agendaitem = agendaitem;
    newsitems.push(newsitem);
  }

  newsitems = setPriorityOnNewsitems(newsitems);

  console.log(`Newsitems to publish:`);
  console.log('---------------------');
  newsitems.forEach(item => console.log(`[${item.number}] ${item.title} (${item.uri})`));
  console.log('---------------------');

  for (let newsitem of newsitems) {
    await sq.insertNewsitem(newsitem, graph);
  }

  return newsitems;
}

async function copyDocuments(newsitems, graph) {
  for (let newsitem of newsitems) {
    const documents = await sq.getPublicDocuments(newsitem.uri, newsitem.agendaitem.kaleidosUri);
    newsitem.nbOfDocuments = documents.length;
    await sq.insertDocuments(documents, newsitem.agendaitem.uri, graph);
  }

  console.log(`Documents to publish:`);
  console.log('---------------------');
  newsitems.forEach(item => console.log(`[${item.number}/${item.nbOfDocuments} documents] ${item.title} (${item.uri})`));
  console.log('---------------------');

}

function setPriorityOnNewsitems(newsitems) {
  const notas = newsitems.filter(item => item.agendaitem.type == config.export.codelists.agendaitemType.nota);

  // Sort notas with mandatees by mandatee(s) priority
  const notasWithMandatees = notas.filter(item => item.mandatees.length > 0);
  for (let nota of notasWithMandatees) {
    nota.mandatees = nota.mandatees.sort((a, b) => a.priority - b.priority);
    nota.group = nota.mandatees.map(mandatee => mandatee.priority).join('-');
  }
  const groupedNotas = groupBy(notasWithMandatees, 'group');
  const groups = Object.keys(groupedNotas).map(key => key.split('-'));
  // sort the groups by mandatee priority
  const sortedKeys = sortMandateeGroups(null, groups).map(group => group.join('-'));
  console.log(`Sorted mandatee groups: ${JSON.stringify(sortedKeys)}`);
  let numberedNotasWithMandatees = [];
  for (let key of sortedKeys) {
    // sort notas in 1 mandatee group by agendaitem number
    const notasInMandateeGroup = groupedNotas[key];
    const numberedNotasInMandateeGroup = sortByAgendaitemAndNumber(notasInMandateeGroup, numberedNotasWithMandatees.length);
    numberedNotasWithMandatees = [...numberedNotasWithMandatees, ...notasInMandateeGroup];
  }

  // Sort notas without mandatees by agendaitem number
  const notasWithoutMandatees = notas.filter(item => item.mandatees.length == 0);
  const numberedNotasWithoutMandatees = sortByAgendaitemAndNumber(notasWithoutMandatees, numberedNotasWithMandatees.length);

  const numberedNotas = [...numberedNotasWithMandatees, ...numberedNotasWithoutMandatees];

  // Sort announcements by agendaitem number
  const announcements = newsitems.filter(item => item.agendaitem.type == config.export.codelists.agendaitemType.announcement);
  const numberedAnnouncements = sortByAgendaitemAndNumber(announcements, numberedNotas.length);

  return [...numberedNotas, ...numberedAnnouncements];
}

function sortMandateeGroups(head, tails) {
  let sortedGroups = tails.filter(t => t.length == 0).map(t => []);

  const nextHeads = uniq(tails.map(tail => tail[0]).filter(t => t));
  nextHeads.sort((a, b) => a - b);
  for (let nextHead of nextHeads) {
    const nextTails = tails.filter(t => t[0] == nextHead).map(t => t.slice(1));
    const sortedTails = sortMandateeGroups(nextHead, nextTails);
    for (let tail of sortedTails) {
      const group = [nextHead, ...tail];
      sortedGroups = [...sortedGroups, group];
    }
  }

  return sortedGroups;
}

function sortByAgendaitemAndNumber(newsitems, baseNumber = 0) {
  newsitems.sort((a, b) => a.agendaitem.number - b.agendaitem.number);
  newsitems.forEach((item, i) => item.number = baseNumber + i + 1);
  return newsitems;
}

async function createTtlToDeltaTask(files) {
  const status = 'http://redpencil.data.gift/ttl-to-delta-tasks/8C7E9155-B467-49A4-B047-7764FE5401F7'; // not started
  const taskUuid = uuid();
  const taskUri = `<http://data.kaleidos.vlaanderen.be/ttl-to-delta-tasks/${taskUuid}>`;

  if (files.length) {
    const fileStatements = files.map((file) => {
      const fileUuid = uuid();
      const fileUri = `<http://data.kaleidos.vlaanderen.be/files/${fileUuid}>`;
      const physicalFileUri = file.replace(config.export.directory, 'share://');
      return `
        ${taskUri} prov:used ${fileUri}.
        ${sparqlEscapeUri(physicalFileUri)} nie:dataSource ${fileUri}.
    `;
    });

    await update(`
      PREFIX adms: <http://www.w3.org/ns/adms#>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      PREFIX prov: <http://www.w3.org/ns/prov#>
      PREFIX nie: <http://www.semanticdesktop.org/ontologies/2007/01/19/nie#>
      INSERT DATA {
        GRAPH <http://mu.semte.ch/graphs/public> {
          ${taskUri} a <http://mu.semte.ch/vocabularies/ext/TtlToDeltaTask>;
            adms:status <${status}> .
            ${fileStatements.join('\n')}
        }
      }`);
  } else {
    console.log(`No files generated by export. No need to create a ttl-to-delta task.`);
  }
}

export {
  generateExport
}
