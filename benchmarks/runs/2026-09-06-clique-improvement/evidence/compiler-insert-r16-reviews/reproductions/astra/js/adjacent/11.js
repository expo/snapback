"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.probe = void 0;
const snapback2_1 = require("snapback2");
const schema_1 = require("./schema");
exports.probe = (0, snapback2_1.mutation)({}, ({ db, ctx, args }) => { const row = db.insert(schema_1.records, { id: ctx.newId(), payload: null }); return db.get(schema_1.records, [{ id: row.missing }]); });
