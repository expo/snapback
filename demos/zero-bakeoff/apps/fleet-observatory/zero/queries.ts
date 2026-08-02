import {defineQueries, defineQuery} from '@rocicorp/zero';
import {zql, type AuthContext} from './schema.ts';

export type EventFilters = {fleetID: string; severity?: string; region?: string; deviceStatus?: string};

export const queries = defineQueries({
  events: {
    latest: defineQuery(({args, ctx}: {args: EventFilters; ctx: AuthContext}) => {
      let query = zql.fo_event
        .where('fleetID', args.fleetID)
        .whereExists('fleet', (fleets) => fleets.whereExists('members', (members) => members.where('userID', ctx.userID)));
      if (args.severity) query = query.where('severity', args.severity);
      if (args.region) query = query.where('region', args.region);
      if (args.deviceStatus) query = query.where('deviceStatus', args.deviceStatus);
      return query.related('device').related('owner').orderBy('pageKey', 'desc').limit(100);
    }),
  },
});

