import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const document = {
  openapi: '3.0.3',
  info: {
    title: 'ZenOps API',
    version: '0.1.0'
  },
  paths: {
    '/v1/health': {
      get: { summary: 'Health check', responses: { '200': { description: 'OK' } } }
    },
    '/v1/auth/login': {
      post: { summary: 'Issue local JWT', responses: { '200': { description: 'Token issued' } } }
    },
    '/v1/tenants': {
      get: { summary: 'List tenants', responses: { '200': { description: 'OK' } } },
      post: { summary: 'Create tenant', responses: { '201': { description: 'Created' } } }
    },
    '/v1/users': {
      get: { summary: 'List users', responses: { '200': { description: 'OK' } } },
      post: { summary: 'Create user', responses: { '201': { description: 'Created' } } }
    },
    '/v1/work-orders': {
      get: { summary: 'List work orders', responses: { '200': { description: 'OK' } } },
      post: { summary: 'Create work order', responses: { '201': { description: 'Created' } } }
    },
    '/v1/assignments': {
      get: { summary: 'List assignments', responses: { '200': { description: 'OK' } } },
      post: { summary: 'Create assignment', responses: { '201': { description: 'Created' } } }
    },
    '/v1/report-requests': {
      get: { summary: 'List report requests', responses: { '200': { description: 'OK' } } },
      post: { summary: 'Create report request', responses: { '201': { description: 'Created' } } }
    },
    '/v1/report-requests/{id}/queue-draft': {
      post: { summary: 'Reserve credit and enqueue draft', responses: { '200': { description: 'Queued' } } }
    },
    '/v1/report-requests/{id}/finalize': {
      post: { summary: 'Finalize report request', responses: { '200': { description: 'Finalized' } } }
    },
    '/v1/report-jobs': {
      get: { summary: 'List report jobs', responses: { '200': { description: 'OK' } } }
    },
    '/v1/studio/report-jobs': {
      get: { summary: 'Studio-only report jobs', responses: { '200': { description: 'OK' } } }
    }
  }
};

await writeFile(resolve(process.cwd(), 'openapi.json'), JSON.stringify(document, null, 2));
