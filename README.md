# Themis export service

Microservice that exports data from Kaleidos to be published on [Themis](https://data.vlaanderen.be).

## Getting started
### Add the export service to your stack
Add the following snippet to your `docker-compose.yml`:
```yml
  export:
    image: kanselarij-vlaanderen/themis-export-service
    links:
      - database:database
    volumes:
      - ./data/exports/:/share
```

The final result of the export will be written to the volume mounted in `/share`.

## How-to guides
### How to query a remote Kaleidos triple store
To run the export querying a Kaleidos triple store on a remote server, setup an SSH tunnel with port forwarding on your `docker0` network interface (probably IP 172.17.0.1):
```bash
ssh kaleidos-server -L 172.17.0.1:8895:<kaleidos-triple-store-container-ip>:8890
```

Add an extra host `kaleidos` to the export service pointing to the `docker0` network and configure the `KALEIDOS_SPARQL_ENDPOINT` environment variable.
```yml
  export:
    ...
    environment:
      KALEIDOS_SPARQL_ENDPOINT: "http://kaleidos:8895/sparql"
    extra_hosts:
      - "kaleidos:172.17.0.1"
```

## Reference
### Configuration
The following environment variables can be configured:
* `MU_SPARQL_ENDPOINT` (default: http://database:8890/sparql): SPARQL endpoint of the internal triple store to write intermediate results to
* `VIRTUOSO_SPARQL_ENDPOINT` (default: http://virtuoso:8890/sparql): SPARQL endpoint of the Virtuoso triple store, in order to extract the ttl files.
* `KALEIDOS_SPARQL_ENDPOINT` (default: http://kaleidos:8890/sparql): SPARQL endpoint of the Kaleidos triple store
* `EXPORT_BATCH_SIZE` (default: 1000): number of triples to export in batch in the final dump

### Model
#### Used prefixes
| Prefix | URI                                 |
|--------|-------------------------------------|
| dct    | http://purl.org/dc/terms/           |
| adms   | http://www.w3.org/ns/adms#          |
| prov   | http://www.w3.org/ns/prov#          |
| ext    | http://mu.semte.ch/vocabularies/ext |

#### Public export job
##### Class
`ext:PublicExportJob`
##### Properties
| Name    | Predicate     | Range           | Definition                                                                                                             |
|---------|---------------|-----------------|------------------------------------------------------------------------------------------------------------------------|
| status  | `adms:status` | `rdfs:Resource` | Status of the export job, initially set to `<http://data.kaleidos.vlaanderen.be/public-export-job-statuses/scheduled>` |
| meeting | `prov:used`   | `rdfs:Resource` | Meeting (in Kaleidos) the export job is executed for                                                                   |
| created | `dct:created` | `xsd:dateTime`  | Datetime of creation of the job                                                                                        |
| scope   | `ext:scope`   | `xsd:string`    | Scope of the export jobs. Possible values are `newsitems` and `documents`. A job may contain multiple scopes.          |
| results   | `prov:generated`   | `rdfs:Resource`    | The resources generated by the export job.          |

#### Export job statuses
The status of the export job will be updated to reflect the progress of the job. The following statuses are known:
* http://data.kaleidos.vlaanderen.be/public-export-job-statuses/scheduled
* http://data.kaleidos.vlaanderen.be/public-export-job-statuses/ongoing
* http://data.kaleidos.vlaanderen.be/public-export-job-statuses/success
* http://data.kaleidos.vlaanderen.be/public-export-job-statuses/failure

### Exported data
The data model used for the exported data is documented on the [Themis documentation website](https://themis.vlaanderen.be/docs/catalogs).

### API
#### POST /meetings/:uuid/publication-activities
Trigger the publication of the Kaleidos meeting with the given `:uuid`. In case the meeting has already been published before, the new publication will be linked to the previous one on Themis.

##### Request
Example request body:

```javascript
{
  "data": {
    "type": "publication-activity",
    "attributes": {
      "scope": ["newsitems", "documents"]
    }
  }
}
```

The following attributes can be set on the publication-activity:
* scope: determines the scope of the export. Supported values are `"newsitems"` and `"documents"`. Documents can only be exported if the newsitems are exported as well. To unpublish a meeting, send an empty array as scope.

##### Response
- **202 Accepted** on successfull trigger of an export. The `Location` response header contains the endpoint to monitor the progress of the job.
- **400 Bad Request** on invalid scope in the request body
- **404 Not Found** if a meeting with the given id cannot be found in Kaleidos

#### GET /public-export-jobs/:uuid
Get the details, including the status, of an export job

##### Response
- **200 OK** with job details in the response body
- **404 Not Found** if a job with the given id cannot be found

#### GET /public-export-jobs/summary
Get a summary of the triggered export jobs. Contains the number of export jobs, grouped per status.

##### Response
- **200 OK** with the summary in the response body
