#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(resolve(ROOT, "action-schema.json"), "utf8"));
const verbSpecs = new Map(schema.verbs.map((verb) => [verb.name, verb]));
const checkpointMarkers = new Set(schema.lexicalGrammar.checkpointMarkers);
const CELEBRITY_USER_ID = "u0900";
const CELEBRITY_FOLLOWER_USER_ID = "u0901";
const CELEBRITY_FOLLOWER_FOLLOWING = ["u0001", "u0002", "u0003", "u0004", CELEBRITY_USER_ID];

function tokenize(line) {
  const tokens = [];
  let cursor = 0;
  while (cursor < line.length) {
    while (line[cursor] === " " || line[cursor] === "\t") cursor += 1;
    if (cursor >= line.length) break;

    if (line[cursor] === '"') {
      const start = cursor;
      cursor += 1;
      let escaped = false;
      let closed = false;
      while (cursor < line.length) {
        const char = line[cursor];
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === '"') {
          cursor += 1;
          closed = true;
          break;
        }
        cursor += 1;
      }
      if (!closed) throw new Error("unterminated JSON string");
      if (cursor < line.length && line[cursor] !== " " && line[cursor] !== "\t") {
        throw new Error("quoted strings must occupy a complete token");
      }
      const source = line.slice(start, cursor);
      let value;
      try {
        value = JSON.parse(source);
      } catch (error) {
        throw new Error(`invalid JSON string: ${error.message}`);
      }
      if (typeof value !== "string") throw new Error("quoted token is not a string");
      tokens.push({ value, quoted: true });
      continue;
    }

    const start = cursor;
    while (cursor < line.length && line[cursor] !== " " && line[cursor] !== "\t") {
      if (line[cursor] === '"') throw new Error("double quote inside bare token");
      cursor += 1;
    }
    tokens.push({ value: line.slice(start, cursor), quoted: false });
  }
  return tokens;
}

function stringLength(value) {
  return Array.from(value).length;
}

function validateBaseType(value, typeName, argument) {
  if (typeName === "string") {
    const length = stringLength(value);
    if (argument.minLength !== undefined && length < argument.minLength) {
      throw new Error(`${argument.name} is shorter than ${argument.minLength}`);
    }
    if (argument.maxLength !== undefined && length > argument.maxLength) {
      throw new Error(`${argument.name} is longer than ${argument.maxLength}`);
    }
    return;
  }
  if (typeName === "enum") {
    if (!argument.values.includes(value)) {
      throw new Error(`${argument.name} must be one of ${argument.values.join(", ")}`);
    }
    return;
  }
  if (typeName === "imageList") {
    const definition = schema.types.imageList;
    const items = value.split(definition.separator);
    if (items.length < definition.minItems || items.length > definition.maxItems) {
      throw new Error(`${argument.name} must contain ${definition.minItems}-${definition.maxItems} images`);
    }
    const itemPattern = new RegExp(definition.itemPattern);
    if (items.some((item) => !itemPattern.test(item))) {
      throw new Error(`${argument.name} contains a non-fixture PNG path`);
    }
    return;
  }

  const definition = schema.types[typeName];
  if (!definition) throw new Error(`schema references unknown type ${typeName}`);
  if (definition.pattern && !new RegExp(definition.pattern).test(value)) {
    throw new Error(`${argument.name} does not match ${typeName}`);
  }
  if (definition.minLength !== undefined && stringLength(value) < definition.minLength) {
    throw new Error(`${argument.name} is shorter than ${definition.minLength}`);
  }
  if (argument.extensions && !argument.extensions.some((extension) => value.endsWith(extension))) {
    throw new Error(`${argument.name} must end in ${argument.extensions.join(" or ")}`);
  }
}

function validateArgument(token, argument) {
  if (argument.quoted === true && !token.quoted) {
    throw new Error(`${argument.name} must be a quoted JSON string`);
  }
  if (argument.quoted !== true && token.quoted) {
    throw new Error(`${argument.name} must be a bare token`);
  }
  if (argument.type === "option") {
    if (!token.value.startsWith(argument.prefix)) {
      throw new Error(`${argument.name} must start with ${argument.prefix}`);
    }
    const optionValue = token.value.slice(argument.prefix.length);
    validateBaseType(optionValue, argument.valueType, { name: argument.name });
    return;
  }
  validateBaseType(token.value, argument.type, argument);
}

function validateConstraints(tokens, argumentsSpec, constraints = []) {
  const byName = new Map(argumentsSpec.map((argument, index) => [argument.name, tokens[index]?.value]));
  for (const constraint of constraints) {
    if (constraint.kind === "extensionByEnum") {
      const enumValue = byName.get(constraint.enumArgument);
      const pathValue = byName.get(constraint.pathArgument);
      const extensions = constraint.extensions[enumValue] ?? [];
      if (!extensions.some((extension) => pathValue.endsWith(extension))) {
        throw new Error(`${constraint.pathArgument} has the wrong extension for ${enumValue}`);
      }
    } else if (constraint.kind === "forbidPair") {
      if (
        byName.get(constraint.firstArgument) === constraint.firstValue &&
        byName.get(constraint.secondArgument) === constraint.secondValue
      ) {
        throw new Error(`${constraint.firstValue} cannot be combined with ${constraint.secondValue}`);
      }
    } else {
      throw new Error(`schema references unknown constraint ${constraint.kind}`);
    }
  }
}

function validateVariant(argumentTokens, variant) {
  const argumentsSpec = variant.arguments;
  const requiredCount = argumentsSpec.filter((argument) => !argument.optional).length;
  if (argumentTokens.length < requiredCount || argumentTokens.length > argumentsSpec.length) {
    throw new Error(`expected ${requiredCount}${requiredCount === argumentsSpec.length ? "" : `-${argumentsSpec.length}`} arguments, got ${argumentTokens.length}`);
  }
  for (let index = 0; index < argumentTokens.length; index += 1) {
    validateArgument(argumentTokens[index], argumentsSpec[index]);
  }
  validateConstraints(argumentTokens, argumentsSpec, variant.constraints);
}

function validateActionLine(line) {
  const tokens = tokenize(line);
  if (tokens.length < 3) throw new Error("action needs timestamp, actor, and verb");
  const [timestamp, actor, verb, ...argumentTokens] = tokens;
  if (timestamp.quoted || actor.quoted || verb.quoted) {
    throw new Error("timestamp, actor, and verb must be bare tokens");
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(timestamp.value)) {
    throw new Error("timestamp must be whole-second RFC 3339 UTC");
  }
  if (!Number.isFinite(Date.parse(timestamp.value))) throw new Error("timestamp is not a real instant");
  validateBaseType(actor.value, "actorId", { name: "actor" });
  const spec = verbSpecs.get(verb.value);
  if (!spec) throw new Error(`unknown verb ${verb.value}`);

  const errors = [];
  for (const variant of spec.variants) {
    try {
      validateVariant(argumentTokens, variant);
      return {
        timestamp: timestamp.value,
        actorId: actor.value,
        verb: verb.value,
        args: argumentTokens.map((token) => token.value)
      };
    } catch (error) {
      errors.push(error.message);
    }
  }
  throw new Error(`${verb.value} does not match any variant: ${errors.join("; ")}`);
}

function makeFixtureTracker() {
  return {
    scaleUsers: new Set(),
    follows: new Set(),
    topLevelPostsByAuthor: new Map(),
    conversations: new Map(),
    messagesByConversation: new Map()
  };
}

function trackFixtureAction(tracker, action) {
  const { actorId, verb, args } = action;
  if (verb === "register" && /^u\d{4}$/.test(actorId)) {
    tracker.scaleUsers.add(actorId);
  } else if (verb === "follow") {
    const edge = `${actorId}>${args[0]}`;
    if (args[1] === "set") tracker.follows.add(edge);
    else tracker.follows.delete(edge);
  } else if (verb === "post") {
    tracker.topLevelPostsByAuthor.set(
      actorId,
      (tracker.topLevelPostsByAuthor.get(actorId) ?? 0) + 1
    );
  } else if (verb === "dm-create") {
    tracker.conversations.set(args[0], new Set([actorId, args[1]]));
  } else if (verb === "group-create") {
    tracker.conversations.set(args[0], new Set([actorId, args[1]]));
  } else if (verb === "member-add") {
    tracker.conversations.get(args[0])?.add(args[1]);
  } else if (verb === "send" || verb === "send-media") {
    tracker.messagesByConversation.set(
      args[1],
      (tracker.messagesByConversation.get(args[1]) ?? 0) + 1
    );
  }
}

function followingTargets(tracker, actorId) {
  return [...tracker.follows]
    .filter((edge) => edge.startsWith(`${actorId}>`))
    .map((edge) => edge.slice(edge.indexOf(">") + 1))
    .sort();
}

function validateNamedFixtures(tracker, markerCount) {
  if (markerCount === 0) return null;
  const failures = [];
  const u0500Following = followingTargets(tracker, "u0500");
  const u0005Following = followingTargets(tracker, "u0005");
  const celebrityFollowing = [...tracker.follows].filter((edge) =>
    edge.endsWith(`>${CELEBRITY_USER_ID}`)
  );
  const celebrityPostCount = tracker.topLevelPostsByAuthor.get(CELEBRITY_USER_ID) ?? 0;
  const celebrityFollowerFollowing = followingTargets(tracker, CELEBRITY_FOLLOWER_USER_ID);
  const u0500Conversations = [...tracker.conversations.values()].filter((members) =>
    members.has("u0500")
  );
  const busyMembers = tracker.conversations.get("g0001");
  const busyMessages = tracker.messagesByConversation.get("g0001") ?? 0;

  if (tracker.scaleUsers.size !== 1000) {
    failures.push(`scale users ${tracker.scaleUsers.size}`);
  }
  if (u0500Following.length !== 500) failures.push(`u0500 follows ${u0500Following.length}`);
  if (u0500Conversations.length !== 100) {
    failures.push(`u0500 conversations ${u0500Conversations.length}`);
  }
  if (u0005Following.length !== 5) failures.push(`u0005 follows ${u0005Following.length}`);
  if (celebrityFollowing.length !== 900) {
    failures.push(`${CELEBRITY_USER_ID} followers ${celebrityFollowing.length}`);
  }
  if (celebrityPostCount !== 200) {
    failures.push(`${CELEBRITY_USER_ID} posts ${celebrityPostCount}`);
  }
  if (JSON.stringify(celebrityFollowerFollowing) !== JSON.stringify(CELEBRITY_FOLLOWER_FOLLOWING)) {
    failures.push(
      `${CELEBRITY_FOLLOWER_USER_ID} follows ${celebrityFollowerFollowing.join(",")}`
    );
  }
  if (busyMembers?.size !== 50) failures.push(`g0001 members ${busyMembers?.size ?? 0}`);
  if (busyMessages !== 10000) failures.push(`g0001 messages ${busyMessages}`);

  if (failures.length > 0) throw new Error(`named fixture drift: ${failures.join(", ")}`);
  return `u0500/u0005/${CELEBRITY_USER_ID}/${CELEBRITY_FOLLOWER_USER_ID}/g0001`;
}

function validateFile(filename) {
  const source = filename === "-" ? readFileSync(0, "utf8") : readFileSync(filename, "utf8");
  if (!source.endsWith("\n")) throw new Error(`${filename}: file must end with a newline`);
  const lines = source.slice(0, -1).split("\n");
  let actionCount = 0;
  let markerCount = 0;
  let previousTimestamp = null;
  const verbs = new Set();
  const fixtureTracker = makeFixtureTracker();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.length === 0) throw new Error(`${filename}:${index + 1}: blank lines are forbidden`);
    if (line.startsWith("#")) {
      if (!checkpointMarkers.has(line)) throw new Error(`${filename}:${index + 1}: unknown marker`);
      markerCount += 1;
      continue;
    }
    try {
      const action = validateActionLine(line);
      if (previousTimestamp !== null && action.timestamp <= previousTimestamp) {
        throw new Error("timestamps must increase strictly within a file");
      }
      previousTimestamp = action.timestamp;
      actionCount += 1;
      verbs.add(action.verb);
      trackFixtureAction(fixtureTracker, action);
    } catch (error) {
      throw new Error(`${filename}:${index + 1}: ${error.message}`);
    }
  }

  return {
    filename,
    actionCount,
    markerCount,
    verbs: [...verbs].sort(),
    namedFixtures: validateNamedFixtures(fixtureTracker, markerCount)
  };
}

const filenames = process.argv.slice(2);
if (filenames.length === 0) {
  process.stderr.write("usage: node validate.mjs <action-log> [...]\n");
  process.exit(2);
}

try {
  let totalActions = 0;
  for (const input of filenames) {
    const result = validateFile(input === "-" ? "-" : resolve(input));
    totalActions += result.actionCount;
    process.stdout.write(
      `valid ${input}: ${result.actionCount} actions, ${result.markerCount} markers, ${result.verbs.length} verbs\n`
    );
    if (result.namedFixtures) {
      process.stdout.write(`valid ${input}: named fixtures ${result.namedFixtures}\n`);
    }
  }
  process.stdout.write(`validated ${filenames.length} logs and ${totalActions} actions against ${schema.schemaVersion}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
