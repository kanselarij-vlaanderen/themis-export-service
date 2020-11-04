export default {
  kaleidos: {
    graphs: {
      kanselarij: 'http://mu.semte.ch/graphs/organizations/kanselarij',
      public: 'http://mu.semte.ch/graphs/public'
    },
    accessLevels: {
      public: 'http://kanselarij.vo.data.gift/id/concept/toegangs-niveaus/6ca49d86-d40f-46c9-bde3-a322aa7e5c8e'
    }
  },
  export: {
    graphs: {
      job: 'http://mu.semte.ch/graphs/kaleidos-export',
      public: 'http://mu.semte.ch/graphs/public',
      tmp: function(timestamp) { return `http://mu.semte.ch/graphs/tmp/${timestamp}`; }
    },
    job: {
      statuses: {
        scheduled: 'http://data.kaleidos.vlaanderen.be/public-export-job-statuses/scheduled',
        ongoing: 'http://data.kaleidos.vlaanderen.be/public-export-job-statuses/ongoing',
        success: 'http://data.kaleidos.vlaanderen.be/public-export-job-statuses/success',
        failure: 'http://data.kaleidos.vlaanderen.be/public-export-job-statuses/failure'
      }
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
  }
};
