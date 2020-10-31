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
        publication: 'http://themis.vlaanderen.be/id/activity-types/a22bbaae-ab5d-4d93-b658-3d31485bea7b'
      },
      agendaStatus: {
        public: 'http://themis.vlaanderen.be/id/agenda-status/212d0a6e-0d4a-43e3-8e7b-f7b3ac03b9cb'
      },
      agendaitemType: {
        nota: 'http://themis.vlaanderen.be/id/agendapunt-types/f51aaa40-58d5-4fd0-97bd-04aa7656dd23',
        announcement: 'http://themis.vlaanderen.be/id/agendapunt-types/c04002f5-94c4-4be6-a988-dd5783ad9b87'
      },
      documentType: {
        newsitem: 'http://themis.vlaanderen.be/id/dossier-stuk-types/fd61576a-0611-459b-8f4c-222257504b20'
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
