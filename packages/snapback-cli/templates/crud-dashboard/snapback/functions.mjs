import {
  arg,
  asc,
  defineJsMutation,
  defineLiveQuery,
  defineRelationalQuery,
  eq,
  results,
  v,
} from '@expo/snapback-codegen/define';
import { projects, teams } from './schema.mjs';

export const projectDirectory = defineRelationalQuery({
  root: projects,
  joined: teams,
  join: [{ root: 'teamSlug', joined: 'slug' }],
  kind: 'left',
  visibility: {
    root: { kind: 'public-read' },
    joined: { kind: 'public-read' },
    output: 'public-read',
  },
  projection: {
    projectKey: { root: 'projectKey' },
    title: { root: 'title' },
    summary: { root: 'summary' },
    status: { root: 'status' },
    budget: { root: 'budget' },
    updatedAt: { root: 'updatedAt' },
    teamSlug: { root: 'teamSlug' },
    teamName: { joined: 'name' },
    teamColor: { joined: 'color' },
  },
  take: 50,
  rootIndex: 'by_updated',
  joinedIndex: 'by_slug',
});

export const projectDetail = defineLiveQuery({
  table: 'projects',
  args: { projectKey: v.string() },
  filter: [eq('projectKey', arg('projectKey'))],
  index: 'by_key',
  auth: 'public',
  authorityIndependent: true,
});

export const listTeams = defineLiveQuery({
  table: 'teams',
  args: {},
  order: [asc('name')],
  auth: 'public',
  authorityIndependent: true,
});

export const createProject = defineJsMutation({
  auth: 'public',
  args: {
    teamSlug: v.string(), title: v.string(), summary: v.string(),
    status: v.string(), budget: v.integer(),
  },
  writes: ['projects'],
  result: results.value(v.string()),
  handler: async (ctx, args) => {
    const projectKey = ctx.runtime.id();
    await ctx.db.insert('projects', { ...args, projectKey, updatedAt: ctx.runtime.now() });
    return projectKey;
  },
});

export const updateProject = defineJsMutation({
  auth: 'public',
  args: {
    projectKey: v.string(), teamSlug: v.string(), title: v.string(),
    summary: v.string(), status: v.string(), budget: v.integer(),
  },
  reads: ['projects'],
  writes: ['projects'],
  result: results.value(v.object({
    projectKey: v.string(), teamSlug: v.string(), title: v.string(),
    summary: v.string(), status: v.string(), budget: v.integer(), updatedAt: v.integer(),
  })),
  handler: async (ctx, args) => {
    const { projectKey, ...fields } = args;
    const row = await ctx.db.query('projects').withIndex('by_key').eq('projectKey', projectKey).first();
    if (!row) throw new Error('project not found');
    const updatedAt = ctx.runtime.now();
    await ctx.db.patch('projects', row._id, { ...fields, updatedAt });
    return { projectKey, ...fields, updatedAt };
  },
});

export const deleteProject = defineJsMutation({
  auth: 'public',
  args: { projectKey: v.string() },
  reads: ['projects'],
  writes: ['projects'],
  result: results.value(v.boolean()),
  handler: async (ctx, { projectKey }) => {
    const row = await ctx.db.query('projects').withIndex('by_key').eq('projectKey', projectKey).first();
    if (!row) throw new Error('project not found');
    await ctx.db.delete('projects', row._id);
    return true;
  },
});
