"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.probe = void 0;
const snapback2_1 = require("snapback2");
const schema_1 = require("./schema");
function put(d, id) { return d.insert(schema_1.records, { id, payload: null }); }
exports.probe = (0, snapback2_1.mutation)({}, ({ db, ctx, args }) => { return put(db, ctx.newId()); });
