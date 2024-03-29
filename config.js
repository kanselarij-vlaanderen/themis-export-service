export default {
  endpoints: {
    virtuoso: process.env.VIRTUOSO_SPARQL_ENDPOINT || "http://triplestore:8890/sparql",
  },
  kaleidos: {
    graphs: {
      kanselarij: 'http://mu.semte.ch/graphs/organizations/kanselarij',
      public: 'http://mu.semte.ch/graphs/public'
    },
    accessLevels: {
      public: 'http://themis.vlaanderen.be/id/concept/toegangsniveau/c3de9c70-391e-4031-a85e-4b03433d6266'
    },
    releaseStatuses: {
      released: 'http://themis.vlaanderen.be/id/concept/vrijgave-status/27bd25d1-72b4-49b2-a0ba-236ca28373e5'
    },
    publication: {
      window: process.env.PUBLICATION_WINDOW_MILLIS || 24*60*60*1000 // fetch publication-activities of last 24h
    },
  },
  export: {
    graphs: {
      job: 'http://mu.semte.ch/graphs/kaleidos-export',
      public: 'http://mu.semte.ch/graphs/themis-public',
      tmp: function(timestamp) { return `http://mu.semte.ch/graphs/tmp/${timestamp}`; }
    },
    job: {
      statuses: {
        scheduled: 'http://data.kaleidos.vlaanderen.be/public-export-job-statuses/scheduled',
        ongoing: 'http://data.kaleidos.vlaanderen.be/public-export-job-statuses/ongoing',
        success: 'http://data.kaleidos.vlaanderen.be/public-export-job-statuses/success',
        failure: 'http://data.kaleidos.vlaanderen.be/public-export-job-statuses/failure'
      },
      maxRetryCount: 5,
    },
    resourceUri: {
      public: function(type, id) { return `http://themis.vlaanderen.be/id/${type}/${id}`; }
    },
    codelists: {
      activityType: {
        publication: 'http://themis.vlaanderen.be/id/concept/activity-type/fb1916be-0a42-4a52-a69d-92764eba4955'
      },
      agendaStatus: {
        public: 'http://themis.vlaanderen.be/id/concept/agenda-status/de6fc320-cfb9-47a6-af25-e063b80992f7'
      },
      agendaitemType: {
        nota: 'http://themis.vlaanderen.be/id/concept/agendapunt-type/dd47a8f8-3ad2-4d5a-8318-66fc02fe80fd',
        announcement: 'http://themis.vlaanderen.be/id/concept/agendapunt-type/8f8adcf0-58ef-4edc-9e36-0c9095fd76b0'
      },
      documentType: {
        newsitem: 'http://themis.vlaanderen.be/id/concept/document-type/63d628cb-a594-4166-8b4e-880b4214fc5b'
      }
    },
    historicDates: {
      newsitems: new Date(Date.parse('2006-07-19T00:00:00.000Z')),
      announcements: new Date(Date.parse('2016-09-08T00:00:00.000Z')),
      documents: new Date(Date.parse('2016-09-08T00:00:00.000Z'))
    },
    directory: process.env.EXPORT_DIR || '/share/'
  },
};
