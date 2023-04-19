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
    PREFIX besluitvorming: <https://data.vlaanderen.be/ns/besluitvorming#>
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>

    CONSTRUCT {
      ${sparqlEscapeUri(uri)} a besluit:Vergaderactiviteit ;
        mu:uuid ?uuid ;
        besluit:geplandeStart ?geplandeStart ;
        besluitvorming:isGehoudenDoor <http://themis.vlaanderen.be/id/bestuursorgaan/7f2c82aa-75ac-40f8-a6c3-9fe539163025> .
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
  // note that we only need to take into account the latest themis-publication-activity with scope "documents" here (hence the LIMIT 1).
  // Otherwise all the existing activities insert a ?documentsPublicationDate into the local graph, including those for "newsitems", which is not what we want.
  await copyToLocalGraph(`
    PREFIX prov: <http://www.w3.org/ns/prov#>
    PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
    PREFIX themis: <http://themis.vlaanderen.be/vocabularies/besluitvorming/>
    PREFIX generiek: <https://data.vlaanderen.be/ns/generiek#>

    CONSTRUCT {
        ${sparqlEscapeUri(uri)} themis:geplandePublicatieDatumDocumenten ?documentsPublicationDate .
    }
    WHERE {
      GRAPH ${sparqlEscapeUri(config.kaleidos.graphs.kanselarij)} {
        ${sparqlEscapeUri(uri)} ^prov:used ?themisPublicationActivity .
        ?themisPublicationActivity a ext:ThemisPublicationActivity .
        ?themisPublicationActivity generiek:geplandeStart ?documentsPublicationDate .
        ?themisPublicationActivity ext:scope "documents" .
      }
    } LIMIT 1
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
  let agendas = parseResult(await queryKaleidos(`
    PREFIX besluitvorming: <https://data.vlaanderen.be/ns/besluitvorming#>
    PREFIX dct: <http://purl.org/dc/terms/>

    SELECT ?uri ?serialNumber ?title WHERE {
     ?uri besluitvorming:isAgendaVoor ${sparqlEscapeUri(meeting)} ;
        besluitvorming:volgnummer ?serialNumber ;
        dct:title ?title .
    } ORDER BY DESC(?serialNumber) LIMIT 1
  `));

  if (!agendas.length) {
    console.log(`No agenda found. Trying pre-Kaleidos query to retrieve agenda for meeting <${meeting}>`);
    agendas = parseResult(await queryKaleidos(`
    PREFIX besluitvorming: <https://data.vlaanderen.be/ns/besluitvorming#>
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>

    SELECT ?uri WHERE {
      ?uri besluitvorming:isAgendaVoor ${sparqlEscapeUri(meeting)} ;
           ext:finaleVersie "true"^^<http://mu.semte.ch/vocabularies/typed-literals/boolean> .
     }
    `));
  }
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
    PREFIX besluitvorming: <https://data.vlaanderen.be/ns/besluitvorming#>

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
      PREFIX besluitvorming: <https://data.vlaanderen.be/ns/besluitvorming#>

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
  return parseResult(await queryKaleidos(`
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX prov: <http://www.w3.org/ns/prov#>
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX besluitvorming: <https://data.vlaanderen.be/ns/besluitvorming#>
    PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
    PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
    PREFIX schema: <http://schema.org/>

    SELECT ?agendaitem AS ?uri ?number ?title ?shortTitle ?type ?previousAgendaitem ?newsletterInfo
    WHERE {
      GRAPH ${sparqlEscapeUri(config.kaleidos.graphs.kanselarij)} {
        <${kaleidosAgenda.uri}> dct:hasPart ?agendaitem .
        ?agendaitem schema:position ?number .
        ?agendaitemTreatment dct:subject ?agendaitem .
        ?newsletterInfo prov:wasDerivedFrom ?agendaitemTreatment .
        ?newsletterInfo ext:inNieuwsbrief "true"^^<http://mu.semte.ch/vocabularies/typed-literals/boolean> .
        OPTIONAL { ?agendaitem dct:title ?title . }
        OPTIONAL { ?agendaitem besluitvorming:korteTitel ?shortTitle . }
        OPTIONAL { ?agendaitem dct:type ?type . }
        OPTIONAL { ?agendaitem besluit:aangebrachtNa ?previousAgendaitem . }
      }
    }`));
}

async function insertPublicAgendaitems(kaleidosAgendaitems, publicAgenda, publication, previousPublication, graph) {
  const publicAgendaitems = [];

  kaleidosAgendaitems.forEach((agendaitem) => {
    const id = uuid();
    agendaitem.publicId = id;
    agendaitem.publicUri = config.export.resourceUri.public('agendapunt', id);
  });

  for (let agendaitem of kaleidosAgendaitems) {
    const now = new Date();

    const optionalStatements = [];
    if (agendaitem.title)
      optionalStatements.push(`<${agendaitem.publicUri}> dct:title ${sparqlEscapeString(agendaitem.title)} .`);
    if (agendaitem.shortTitle)
      optionalStatements.push(`<${agendaitem.publicUri}> besluitvorming:korteTitel ${sparqlEscapeString(agendaitem.shortTitle)} .`);
    if (agendaitem.previousAgendaitem) {
      const previousAgendaitem = kaleidosAgendaitems.find(item => agendaitem.previousAgendaitem == item.uri);
      if (previousAgendaitem)
        optionalStatements.push(`<${agendaitem.publicUri}> besluit:aangebrachtNa ${sparqlEscapeUri(previousAgendaitem.publicUri)} .`);
    }

    await update(`
      PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
      PREFIX prov: <http://www.w3.org/ns/prov#>
      PREFIX dct: <http://purl.org/dc/terms/>
      PREFIX besluitvorming: <https://data.vlaanderen.be/ns/besluitvorming#>
      PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
      PREFIX schema: <http://schema.org/>

      INSERT DATA {
        GRAPH <${graph}> {
          <${agendaitem.publicUri}> a besluit:Agendapunt ;
            mu:uuid ${sparqlEscapeString(agendaitem.publicId)} ;
            dct:created ${sparqlEscapeDateTime(now)} ;
            dct:modified ${sparqlEscapeDateTime(now)} ;
            schema:position ${sparqlEscapeInt(agendaitem.number)} ;
            besluit:Agendapunt.type ${sparqlEscapeUri(agendaitem.type)} ;
            prov:wasDerivedFrom ${sparqlEscapeUri(agendaitem.uri)} .
          ${optionalStatements.join('\n')}
          <${publication}> prov:generated <${agendaitem.publicUri}> .
          <${publicAgenda.uri}> dct:hasPart <${agendaitem.publicUri}> .
        }
      }`);

    if (previousPublication) {
      await update(`
        PREFIX prov: <http://www.w3.org/ns/prov#>
        PREFIX besluitvorming: <https://data.vlaanderen.be/ns/besluitvorming#>
        PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>

        INSERT {
          GRAPH <${graph}> {
            <${agendaitem.publicUri}> prov:wasRevisionOf ?previousPublicAgendaitem .
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
      id: agendaitem.publicId,
      uri: agendaitem.publicUri,
      kaleidosUri: agendaitem.uri,
      newsletterInfo: agendaitem.newsletterInfo,
      number: agendaitem.number,
      type: agendaitem.type,
      shortTitle: agendaitem.shortTitle,
      title: agendaitem.title
    });
  }

  return publicAgendaitems;
}

async function getNewsitem(kaleidosNewsitem, kaleidosAgendaitem) {
  const newsitems = parseResult(await queryKaleidos(`
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX prov: <http://www.w3.org/ns/prov#>
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX nie: <http://www.semanticdesktop.org/ontologies/2007/01/19/nie#>

    SELECT ?id ?title ?richtext ?text ?alternative
    WHERE {
      GRAPH ${sparqlEscapeUri(config.kaleidos.graphs.kanselarij)} {
        <${kaleidosNewsitem}> dct:title ?title ;
                              mu:uuid ?id .
        OPTIONAL { <${kaleidosNewsitem}> nie:htmlContent ?richtext . }
        OPTIONAL { <${kaleidosNewsitem}> prov:value ?text . }
        OPTIONAL { <${kaleidosNewsitem}> dct:alternative ?alternative . }
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
      PREFIX besluitvorming: <https://data.vlaanderen.be/ns/besluitvorming#>
      PREFIX prov: <http://www.w3.org/ns/prov#>
      PREFIX mandaat: <http://data.vlaanderen.be/ns/mandaat#>
      PREFIX dct: <http://purl.org/dc/terms/>

      SELECT ?uri ?priority
      WHERE {
        GRAPH ${sparqlEscapeUri(config.kaleidos.graphs.kanselarij)} {
          <${kaleidosNewsitem}> prov:wasDerivedFrom ?agendaitemTreatment .
          ?agendaitemTreatment dct:subject <${kaleidosAgendaitem}> .
          ?agendaActivity besluitvorming:genereertAgendapunt <${kaleidosAgendaitem}> ;
                          besluitvorming:vindtPlaatsTijdens ?subcase .
          ?subcase ext:heeftBevoegde ?uri .
        }
        GRAPH ${sparqlEscapeUri(config.kaleidos.graphs.public)} {
          OPTIONAL {
              ?uri mandaat:rangorde ?priority .
          }
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
  if (newsitem.title)
    optionalStatements.push(`<${newsitem.uri}> dct:title ${sparqlEscapeString(newsitem.title)} .`);
  if (newsitem.alternative)
    optionalStatements.push(`<${newsitem.uri}> dct:alternative ${sparqlEscapeString(newsitem.alternative)} .`);
  if (newsitem.themes.length)
    optionalStatements.push(...newsitem.themes.map(theme => `<${newsitem.uri}> dct:subject ${sparqlEscapeUri(theme.uri)} .`));
  if (newsitem.mandatees.length)
    optionalStatements.push(...newsitem.mandatees.map(mandatee => `<${newsitem.uri}> prov:qualifiedAssociation ${sparqlEscapeUri(mandatee.uri)} .`));

  await update(`
      PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
      PREFIX prov: <http://www.w3.org/ns/prov#>
      PREFIX dct: <http://purl.org/dc/terms/>
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
    PREFIX besluitvorming: <https://data.vlaanderen.be/ns/besluitvorming#>
    PREFIX prov: <http://www.w3.org/ns/prov#>
    PREFIX dct: <http://purl.org/dc/terms/>

    SELECT ?piece AS ?uri
    WHERE {
      GRAPH ${sparqlEscapeUri(config.kaleidos.graphs.kanselarij)} {
        <${kaleidosNewsitem}> prov:wasDerivedFrom ?agendaitemTreatment .
        ?agendaitemTreatment dct:subject <${kaleidosAgendaitem}> .
        ?agendaActivity besluitvorming:genereertAgendapunt <${kaleidosAgendaitem}> .
        <${kaleidosAgendaitem}> besluitvorming:geagendeerdStuk ?piece .
        ?piece besluitvorming:vertrouwelijkheidsniveau <${config.kaleidos.accessLevels.public}> .
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

    // Copy dossier
    await copyToLocalGraph(`
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX dossier: <https://data.vlaanderen.be/ns/dossier#>

    CONSTRUCT {
      ?dossier a dossier:Dossier ;
        mu:uuid ?uuid ;
        dossier:Dossier.bestaatUit ${sparqlEscapeUri(piece.uri)} .
    }
    WHERE {
      GRAPH ${sparqlEscapeUri(config.kaleidos.graphs.kanselarij)} {
        ?dossier a dossier:Dossier ;
          mu:uuid ?uuid ;
          dossier:Dossier.bestaatUit ${sparqlEscapeUri(piece.uri)} .
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
        ?documentContainer a dossier:Serie ;
          dossier:Collectie.bestaatUit ${sparqlEscapeUri(piece.uri)} ;
          mu:uuid ?documentContainerUuid .
      }
    }`, graph);

    // Copy document container type
    await copyToLocalGraph(`
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX dossier: <https://data.vlaanderen.be/ns/dossier#>

    CONSTRUCT {
      ?documentContainer dct:type ?documentType .
    }
    WHERE {
      GRAPH ${sparqlEscapeUri(config.kaleidos.graphs.kanselarij)} {
        ?documentContainer a dossier:Serie ;
          dossier:Collectie.bestaatUit ${sparqlEscapeUri(piece.uri)} ;
          dct:type ?documentType .
      }
    }`, graph);

    // Link pieces to newsitem
    await update(`
      PREFIX prov: <http://www.w3.org/ns/prov#>
      PREFIX besluitvorming: <https://data.vlaanderen.be/ns/besluitvorming#>

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

    // Copy source files of piece
    await copyToLocalGraph(`
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
    PREFIX nfo: <http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#>
    PREFIX nie: <http://www.semanticdesktop.org/ontologies/2007/01/19/nie#>
    PREFIX dbpedia: <http://dbpedia.org/ontology/>
    PREFIX dossier: <https://data.vlaanderen.be/ns/dossier#>
    PREFIX prov: <http://www.w3.org/ns/prov#>
    PREFIX dct: <http://purl.org/dc/terms/>

    CONSTRUCT {
      ${sparqlEscapeUri(piece.uri)} prov:value ?uploadFile .
      ?uploadFile a nfo:FileDataObject ;
        mu:uuid ?uuidUploadFile ;
        nfo:fileName ?fileNameUploadFile ;
        nfo:fileSize ?sizeUploadFile ;
        dbpedia:fileExtension ?extensionUploadFile ;
        dct:format ?format .
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
          prov:value ?uploadFile .
        ?uploadFile a nfo:FileDataObject ;
          mu:uuid ?uuidUploadFile ;
          nfo:fileName ?fileNameUploadFile ;
          nfo:fileSize ?sizeUploadFile ;
          dbpedia:fileExtension ?extensionUploadFile ;
          dct:format ?format ;
          ^nie:dataSource ?physicalFile .
        ?physicalFile a nfo:FileDataObject ;
          mu:uuid ?uuidPhysicalFile ;
          nfo:fileName ?fileNamePhysicalFile ;
          nfo:fileSize ?sizePhysicalFile ;
          dbpedia:fileExtension ?extensionPhysicalFile .
      }
    }`, graph);

    // Copy derived files of piece
    await copyToLocalGraph(`
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
    PREFIX nfo: <http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#>
    PREFIX nie: <http://www.semanticdesktop.org/ontologies/2007/01/19/nie#>
    PREFIX dbpedia: <http://dbpedia.org/ontology/>
    PREFIX dossier: <https://data.vlaanderen.be/ns/dossier#>
    PREFIX prov: <http://www.w3.org/ns/prov#>
    PREFIX dct: <http://purl.org/dc/terms/>

    CONSTRUCT {
      ?derivedFile a nfo:FileDataObject ;
        mu:uuid ?uuidDerivedFile ;
        nfo:fileName ?fileNameDerivedFile ;
        nfo:fileSize ?sizeDerivedFile ;
        dbpedia:fileExtension ?extensionDerivedFile ;
        dct:format ?format ;
        prov:hadPrimarySource ?sourceFile .
      ?physicalFile a nfo:FileDataObject ;
        mu:uuid ?uuidPhysicalFile ;
        nfo:fileName ?fileNamePhysicalFile ;
        nfo:fileSize ?sizePhysicalFile ;
        dbpedia:fileExtension ?extensionPhysicalFile ;
        nie:dataSource ?derivedFile .
    }
    WHERE {
      GRAPH ${sparqlEscapeUri(config.kaleidos.graphs.kanselarij)} {
        ${sparqlEscapeUri(piece.uri)} a dossier:Stuk ;
          prov:value ?sourceFile .
        ?derivedFile prov:hadPrimarySource ?sourceFile .
        ?derivedFile a nfo:FileDataObject ;
          mu:uuid ?uuidDerivedFile ;
          nfo:fileName ?fileNameDerivedFile ;
          nfo:fileSize ?sizeDerivedFile ;
          dbpedia:fileExtension ?extensionDerivedFile ;
          dct:format ?format ;
          ^nie:dataSource ?physicalFile .
        ?physicalFile a nfo:FileDataObject ;
          mu:uuid ?uuidPhysicalFile ;
          nfo:fileName ?fileNamePhysicalFile ;
          nfo:fileSize ?sizePhysicalFile ;
          dbpedia:fileExtension ?extensionPhysicalFile .
      }
    }`, graph);
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
