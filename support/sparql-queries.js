import { uuid, sparqlEscapeString, sparqlEscapeUri, sparqlEscapeDateTime, sparqlEscapeInt } from 'mu';
import { queryKaleidos } from './kaleidos';
// All intermediate data is written directly to Virtuoso in order to not generate delta notifications for these data insertions
// Virtuoso is just used here as a temporary store to gather data before writing it to a file
import { queryVirtuoso as query, updateVirtuoso as update } from './virtuoso';
import { parseResult, copyToLocalGraph } from './query-helpers';
import config from '../config.js';

async function getMeeting({ uri, id }) {
  let subjectStatement = '';
  if (uri) {
    subjectStatement = `BIND(<${uri}> as ?uri)`;
  } else {
    subjectStatement = `?uri mu:uuid ${sparqlEscapeString(id)} .`;
  }
  const sessions = parseResult(await queryKaleidos(`
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
    PREFIX prov: <http://www.w3.org/ns/prov#>
    PREFIX dct: <http://purl.org/dc/terms/>

    SELECT ?uri ?geplandeStart ?location ?type
    WHERE {
      GRAPH ${sparqlEscapeUri(config.kaleidos.graphs.kanselarij)} {
        ${subjectStatement}
        ?uri a besluit:Vergaderactiviteit ;
          besluit:geplandeStart ?geplandeStart .
        OPTIONAL { ?uri prov:atLocation ?location . }
        OPTIONAL { ?uri dct:type ?type . }
      }
    }
  `));
  return sessions.length ? sessions[0] : null;
}

async function copyMeeting(uri, graph) {
  await copyToLocalGraph(`
    PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>

    CONSTRUCT {
      ${sparqlEscapeUri(uri)} a besluit:Vergaderactiviteit ;
        mu:uuid ?uuid ;
        besluit:geplandeStart ?geplandeStart .
    }
    WHERE {
      GRAPH ${sparqlEscapeUri(config.kaleidos.graphs.kanselarij)} {
        ${sparqlEscapeUri(uri)} a besluit:Vergaderactiviteit ;
          mu:uuid ?uuid ;
          besluit:geplandeStart ?geplandeStart .
      }
    }
  `, graph);

  const optionalProperties = [
    'http://purl.org/dc/terms/type',
    'http://www.w3.org/ns/prov#atLocation',
    { from: 'http://mu.semte.ch/vocabularies/ext/numberRepresentation', to: 'http://purl.org/dc/terms/identifier' }
  ];
  for (let prop of optionalProperties) {
    if (typeof(prop) == "string")
      prop = { from: prop, to: prop };
    await copyToLocalGraph(`
      CONSTRUCT {
        ${sparqlEscapeUri(uri)} <${prop.to}> ?value .
      }
      WHERE {
        GRAPH ${sparqlEscapeUri(config.kaleidos.graphs.kanselarij)} {
          ${sparqlEscapeUri(uri)} <${prop.from}> ?value .
        }
      }`, graph);
  }

  await copyToLocalGraph(`
    PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
    PREFIX themis: <http://themis.vlaanderen.be/vocabularies/besluitvorming/>

    CONSTRUCT {
        ${sparqlEscapeUri(uri)} themis:geplandePublicatieDatumDocumenten ?documentsPublicationDate .
    }
    WHERE {
      GRAPH ${sparqlEscapeUri(config.kaleidos.graphs.kanselarij)} {
        ${sparqlEscapeUri(uri)} ext:algemeneNieuwsbrief ?newsletter .
        ?newsletter ext:issuedDocDate ?documentsPublicationDate .
      }
    }
  `, graph);
}

async function insertPublicationActivity(meeting, graph) {
  const id = uuid();
  const activity = config.export.resourceUri.public('publicatie-activiteit', id);
  const now = new Date();

  await update(`
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX prov: <http://www.w3.org/ns/prov#>
    PREFIX dct: <http://purl.org/dc/terms/>

    INSERT DATA {
      GRAPH <${graph}> {
        <${activity}> a prov:Activity ;
          mu:uuid ${sparqlEscapeString(id)} ;
          prov:startedAtTime ${sparqlEscapeDateTime(now)} ;
          dct:type ${sparqlEscapeUri(config.export.codelists.activityType.publication)} ;
          prov:used ${sparqlEscapeUri(meeting)} .
      }
    }
  `);

  return {
    id: id,
    uri: activity
  };
}

async function getPreviousPublicationActivity(meeting) {
  const publications = parseResult(await query(`
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX prov: <http://www.w3.org/ns/prov#>
    PREFIX dct: <http://purl.org/dc/terms/>

    SELECT ?uri ?start
    WHERE {
      GRAPH <${config.export.graphs.public}> {
        ?uri a prov:Activity ;
          prov:startedAtTime ?start ;
          dct:type ${sparqlEscapeUri(config.export.codelists.activityType.publication)} ;
          prov:used ${sparqlEscapeUri(meeting)} .
      }
    } ORDER BY DESC(?start) LIMIT 1`));

  return publications.length ? publications[0] : null;
}

async function getLatestAgendaOfMeeting(meeting) {
  const agendas = parseResult(await queryKaleidos(`
    PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
    PREFIX dct: <http://purl.org/dc/terms/>

    SELECT ?uri ?serialNumber ?title WHERE {
     ?uri besluitvorming:isAgendaVoor ${sparqlEscapeUri(meeting)} ;
        besluitvorming:volgnummer ?serialNumber ;
        dct:title ?title .
    } ORDER BY DESC(?serialNumber) LIMIT 1
  `));
  return agendas.length ? agendas[0] : null;
}

async function insertPublicAgenda(kaleidosAgenda, meeting, publication, previousPublication, graph) {
  const id = uuid();
  const publicAgenda = config.export.resourceUri.public('agenda', id);
  const title = kaleidosAgenda.title ? `Publieke ${kaleidosAgenda.title}` : 'Publieke agenda';
  const now = new Date();

  await update(`
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX prov: <http://www.w3.org/ns/prov#>
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>

    INSERT DATA {
      GRAPH <${graph}> {
        <${publicAgenda}> a besluitvorming:Agenda ;
          mu:uuid ${sparqlEscapeString(id)} ;
          dct:created ${sparqlEscapeDateTime(now)} ;
          dct:modified ${sparqlEscapeDateTime(now)} ;
          dct:title ${sparqlEscapeString(title)} ;
          besluitvorming:agendaStatus ${sparqlEscapeUri(config.export.codelists.agendaStatus.public)} ;
          besluitvorming:isAgendaVoor ${sparqlEscapeUri(meeting)} ;
          prov:wasDerivedFrom ${sparqlEscapeUri(kaleidosAgenda.uri)} .
        <${publication}> prov:generated <${publicAgenda}> .
      }
    }
  `);

  if (previousPublication) {
    await update(`
      PREFIX prov: <http://www.w3.org/ns/prov#>
      PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>

      INSERT {
        GRAPH <${graph}> {
          <${publicAgenda}> prov:wasRevisionOf ?previousPublicAgenda .
        }
      } WHERE {
        GRAPH <${config.export.graphs.public}> {
          <${previousPublication}> prov:generated ?previousPublicAgenda .
          ?previousPublicAgenda a besluitvorming:Agenda .
        }
      }
    `);
  }

  return {
    id: id,
    uri: publicAgenda
  };
}

async function getAgendaitemsWithNewsletterInfo(kaleidosAgenda) {
  // Note: only newsitems related to a 'Nota' have an ext:afgewerkt flag
  return parseResult(await queryKaleidos(`
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX prov: <http://www.w3.org/ns/prov#>
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
    PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
    PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>

    SELECT ?agendaitem AS ?uri ?number ?title ?alternative ?isAnnouncement ?previousAgendaitem ?newsletterInfo
    WHERE {
      GRAPH ${sparqlEscapeUri(config.kaleidos.graphs.kanselarij)} {
        <${kaleidosAgenda.uri}> dct:hasPart ?agendaitem .
        ?agendaitem ext:prioriteit ?number .
        ?agendaitemTreatment besluitvorming:heeftOnderwerp ?agendaitem ;
                             prov:generated ?newsletterInfo .
        ?newsletterInfo ext:inNieuwsbrief "true"^^<http://mu.semte.ch/vocabularies/typed-literals/boolean> .
        OPTIONAL { ?agendaitem dct:title ?title . }
        OPTIONAL { ?agendaitem dct:alternative ?alternative . }
        OPTIONAL { ?agendaitem ext:wordtGetoondAlsMededeling ?isAnnouncement . }
        OPTIONAL { ?agendaitem besluit:aangebrachtNa ?previousAgendaitem . }
        OPTIONAL { ?newsletterInfo ext:afgewerkt ?afgewerkt . }
        FILTER (STR(?isAnnouncement) = "true" || STR(?afgewerkt) = "true")
      }
    }`));
}

async function insertPublicAgendaitems(kaleidosAgendaitems, publicAgenda, publication, previousPublication, graph) {
  const publicAgendaitems = [];

  for (let agendaitem of kaleidosAgendaitems) {
    const id = uuid();
    const publicAgendaitem = config.export.resourceUri.public('agendapunt', id);
    const now = new Date();

    const optionalStatements = [];
    if (agendaitem.title)
      optionalStatements.push(`<${publicAgendaitem}> dct:title ${sparqlEscapeString(agendaitem.title)} .`);
    if (agendaitem.alternative)
      optionalStatements.push(`<${publicAgendaitem}> besluitvorming:korteTitel ${sparqlEscapeString(agendaitem.alternative)} .`);
    if (agendaitem.previousAgendaitem)
      optionalStatements.push(`<${publicAgendaitem}> besluit:aangebrachtNa ${sparqlEscapeUri(agendaitem.previousAgendaitem)} .`);

    await update(`
      PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
      PREFIX prov: <http://www.w3.org/ns/prov#>
      PREFIX dct: <http://purl.org/dc/terms/>
      PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
      PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
      PREFIX schema: <http://schema.org/>

      INSERT DATA {
        GRAPH <${graph}> {
          <${publicAgendaitem}> a besluit:Agendapunt ;
            mu:uuid ${sparqlEscapeString(id)} ;
            dct:created ${sparqlEscapeDateTime(now)} ;
            dct:modified ${sparqlEscapeDateTime(now)} ;
            schema:position ${sparqlEscapeInt(agendaitem.number)} ;
            besluit:Agendapunt.type ${sparqlEscapeUri(agendaitem.type)} ;
            prov:wasDerivedFrom ${sparqlEscapeUri(agendaitem.uri)} .
          ${optionalStatements.join('\n')}
          <${publication}> prov:generated <${publicAgendaitem}> .
          <${publicAgenda.uri}> dct:hasPart <${publicAgendaitem}> .
        }
      }`);

    if (previousPublication) {
      await update(`
        PREFIX prov: <http://www.w3.org/ns/prov#>
        PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
        PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>

        INSERT {
          GRAPH <${graph}> {
            <${publicAgendaitem}> prov:wasRevisionOf ?previousPublicAgendaitem .
          }
        } WHERE {
          GRAPH <${config.export.graphs.public}> {
            <${previousPublication}> prov:generated ?previousPublicAgendaitem .
            ?previousPublicAgendaitem prov:wasDerivedFrom ${sparqlEscapeUri(agendaitem.uri)} .
            ?previousPublicAgendaitem a besluit:Agendapunt .
          }
        }`);
    }

    publicAgendaitems.push({
      id: id,
      uri: publicAgendaitem,
      kaleidosUri: agendaitem.uri,
      newsletterInfo: agendaitem.newsletterInfo,
      number: agendaitem.number,
      type: agendaitem.type,
      shortTitle: agendaitem.alternative
    });
  }

  return publicAgendaitems;
}

async function getNewsitem(kaleidosNewsitem, kaleidosAgendaitem) {
  const newsitems = parseResult(await queryKaleidos(`
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX prov: <http://www.w3.org/ns/prov#>
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
    PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
    PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>

    SELECT ?id ?title ?richtext ?text ?alternate
    WHERE {
      GRAPH ${sparqlEscapeUri(config.kaleidos.graphs.kanselarij)} {
        <${kaleidosNewsitem}> dct:title ?title ;
                              mu:uuid ?id .
        OPTIONAL { <${kaleidosNewsitem}> ext:htmlInhoud ?richtext . }
        OPTIONAL { <${kaleidosNewsitem}> besluitvorming:inhoud ?text . }
        OPTIONAL { <${kaleidosNewsitem}> dbpedia:subtitle ?alternate . }
      }
    }`));

  const newsitem = newsitems.length ? newsitems[0] : null;

  if (newsitem) {
    newsitem.uri = kaleidosNewsitem;

    newsitem.themes = parseResult(await queryKaleidos(`
      PREFIX dct: <http://purl.org/dc/terms/>

      SELECT ?uri
      WHERE {
        GRAPH ${sparqlEscapeUri(config.kaleidos.graphs.kanselarij)} {
          <${kaleidosNewsitem}> dct:subject ?uri .
        }
      }
    `));

    newsitem.mandatees = parseResult(await queryKaleidos(`
      PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
      PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
      PREFIX prov: <http://www.w3.org/ns/prov#>
      PREFIX mandaat: <http://data.vlaanderen.be/ns/mandaat#>

      SELECT ?uri ?priority
      WHERE {
        GRAPH ${sparqlEscapeUri(config.kaleidos.graphs.kanselarij)} {
          ?agendaitemTreatment prov:generated <${kaleidosNewsitem}> ;
                               besluitvorming:heeftOnderwerp <${kaleidosAgendaitem}> .
          ?agendaActivity besluitvorming:genereertAgendapunt <${kaleidosAgendaitem}> ;
                          besluitvorming:vindtPlaatsTijdens ?subcase .
          ?subcase ext:heeftBevoegde ?uri .
          ?uri mandaat:rangorde ?priority .
        }
      }
    `));
  }

  return newsitem;
}

async function insertNewsitem(newsitem, graph) {
  const now = new Date();

  const optionalStatements = [];
  if (newsitem.richtext)
    optionalStatements.push(`<${newsitem.uri}> nie:htmlContent ${sparqlEscapeString(newsitem.richtext)} .`);
  if (newsitem.text)
    optionalStatements.push(`<${newsitem.uri}> prov:value ${sparqlEscapeString(newsitem.text)} .`);
  if (newsitem.alternate)
    optionalStatements.push(`<${newsitem.uri}> dct:alternate ${sparqlEscapeUri(newsitem.alternate)} .`);
  if (newsitem.themes.length)
    optionalStatements.push(...newsitem.themes.map(theme => `<${newsitem.uri}> dct:subject ${sparqlEscapeUri(theme.uri)} .`));
  if (newsitem.mandatees.length)
    optionalStatements.push(...newsitem.mandatees.map(mandatee => `<${newsitem.uri}> prov:qualifiedAssociation ${sparqlEscapeUri(mandatee.uri)} .`));

  await update(`
      PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
      PREFIX prov: <http://www.w3.org/ns/prov#>
      PREFIX dct: <http://purl.org/dc/terms/>
      PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
      PREFIX dossier: <https://data.vlaanderen.be/ns/dossier#>
      PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
      PREFIX schema: <http://schema.org/>
      PREFIX nie: <http://www.semanticdesktop.org/ontologies/2007/01/19/nie#>

      INSERT DATA {
        GRAPH <${graph}> {
          <${newsitem.uri}> a dossier:Stuk ;
            mu:uuid ${sparqlEscapeString(newsitem.id)} ;
            dct:issued ${sparqlEscapeDateTime(now)} ;
            schema:position ${sparqlEscapeInt(newsitem.number)} ;
            dct:type ${sparqlEscapeUri(config.export.codelists.documentType.newsitem)} ;
            prov:wasDerivedFrom ${sparqlEscapeUri(newsitem.agendaitem.uri)} .
          ${optionalStatements.join('\n')}
        }
      }`);
}

async function getPublicDocuments(kaleidosNewsitem, kaleidosAgendaitem) {
  return parseResult(await queryKaleidos(`
    PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>
    PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
    PREFIX prov: <http://www.w3.org/ns/prov#>

    SELECT ?piece AS ?uri
    WHERE {
      GRAPH ${sparqlEscapeUri(config.kaleidos.graphs.kanselarij)} {
        ?agendaitemTreatment prov:generated <${kaleidosNewsitem}> ;
                             besluitvorming:heeftOnderwerp <${kaleidosAgendaitem}> .
        ?agendaActivity besluitvorming:genereertAgendapunt <${kaleidosAgendaitem}> .
        <${kaleidosAgendaitem}> besluitvorming:geagendeerdStuk ?piece .
        ?piece ext:toegangsniveauVoorDocumentVersie <${config.kaleidos.accessLevels.public}> .
      }
    }
  `));
}

async function insertDocuments(kaleidosPieces, agendaitem, graph) {
  const now = new Date();

  for (let piece of kaleidosPieces) {
    // Copy piece
    await copyToLocalGraph(`
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX dossier: <https://data.vlaanderen.be/ns/dossier#>

    CONSTRUCT {
      ${sparqlEscapeUri(piece.uri)} a dossier:Stuk ;
        mu:uuid ?uuid ;
        dct:title ?title ;
        dct:issued ${sparqlEscapeDateTime(now)} .
    }
    WHERE {
      GRAPH ${sparqlEscapeUri(config.kaleidos.graphs.kanselarij)} {
        ${sparqlEscapeUri(piece.uri)} a dossier:Stuk ;
          mu:uuid ?uuid ;
          dct:title ?title .
      }
    }`, graph);

    // Copy document container
    await copyToLocalGraph(`
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX dossier: <https://data.vlaanderen.be/ns/dossier#>

    CONSTRUCT {
      ?documentContainer a dossier:Serie ;
        mu:uuid ?documentContainerUuid ;
        dossier:Collectie.bestaatUit ${sparqlEscapeUri(piece.uri)} .
    }
    WHERE {
      GRAPH ${sparqlEscapeUri(config.kaleidos.graphs.kanselarij)} {
        ?documentContainer a dossier:Stuk ;
          dossier:collectie.bestaatUit ${sparqlEscapeUri(piece.uri)} ;
          mu:uuid ?documentContainerUuid .
      }
    }`, graph);

    // Copy document container type
    await copyToLocalGraph(`
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX dossier: <https://data.vlaanderen.be/ns/dossier#>
    PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>

    CONSTRUCT {
      ?documentContainer dct:type ?documentType .
    }
    WHERE {
      GRAPH ${sparqlEscapeUri(config.kaleidos.graphs.kanselarij)} {
        ?documentContainer a dossier:Stuk ;
          dossier:Collectie.bestaatUit ${sparqlEscapeUri(piece.uri)} ;
          ext:documentType ?documentType .
      }
    }`, graph);

    // Link pieces to newsitem
    await update(`
      PREFIX prov: <http://www.w3.org/ns/prov#>
      PREFIX besluitvorming: <http://data.vlaanderen.be/ns/besluitvorming#>

      INSERT {
        GRAPH <${graph}> {
          ?newsitem besluitvorming:heeftBijlage <${piece.uri}> .
        }
      } WHERE {
        GRAPH <${graph}> {
          ?newsitem prov:wasDerivedFrom <${agendaitem}> .
        }
      }
    `);

    // Copy files of piece
    await copyToLocalGraph(`
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
    PREFIX nfo: <http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#>
    PREFIX nie: <http://www.semanticdesktop.org/ontologies/2007/01/19/nie#>
    PREFIX dbpedia: <http://dbpedia.org/ontology/>
    PREFIX dossier: <https://data.vlaanderen.be/ns/dossier#>
    PREFIX prov: <http://www.w3.org/ns/prov#>

    CONSTRUCT {
      ${sparqlEscapeUri(piece.uri)} prov:value ?uploadFile .
      ?uploadFile a nfo:FileDataObject ;
        mu:uuid ?uuidUploadFile ;
        nfo:fileName ?fileNameUploadFile ;
        nfo:fileSize ?sizeUploadFile ;
        dbpedia:fileExtension ?extensionUploadFile .
      ?physicalFile a nfo:FileDataObject ;
        mu:uuid ?uuidPhysicalFile ;
        nfo:fileName ?fileNamePhysicalFile ;
        nfo:fileSize ?sizePhysicalFile ;
        dbpedia:fileExtension ?extensionPhysicalFile ;
        nie:dataSource ?uploadFile .
    }
    WHERE {
      GRAPH ${sparqlEscapeUri(config.kaleidos.graphs.kanselarij)} {
        ${sparqlEscapeUri(piece.uri)} a dossier:Stuk ;
          ext:file ?uploadFile .
        ?uploadFile a nfo:FileDataObject ;
          mu:uuid ?uuidUploadFile ;
          nfo:fileName ?fileNameUploadFile ;
          nfo:fileSize ?sizeUploadFile ;
          dbpedia:fileExtension ?extensionUploadFile ;
          ^nie:dataSource ?physicalFile .
        ?physicalFile a nfo:FileDataObject ;
          mu:uuid ?uuidPhysicalFile ;
          nfo:fileName ?fileNamePhysicalFile ;
          nfo:fileSize ?sizePhysicalFile ;
          dbpedia:fileExtension ?extensionPhysicalFile .
      }
    }
  `, graph);
  }
}

export default {
  getMeeting,
  copyMeeting,
  insertPublicationActivity,
  getPreviousPublicationActivity,
  getLatestAgendaOfMeeting,
  insertPublicAgenda,
  getAgendaitemsWithNewsletterInfo,
  insertPublicAgendaitems,
  getNewsitem,
  insertNewsitem,
  getPublicDocuments,
  insertDocuments
};
