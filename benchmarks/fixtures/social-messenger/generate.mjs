#!/usr/bin/env node

import { createHash } from "node:crypto";
import { once } from "node:events";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const GENERATOR_VERSION = "0.2.2-m8";
const SEED = 20260808;
const EPOCH_MS = Date.parse("2026-01-01T00:00:00Z");
const SCALE_ACTION_COUNT = 167157;
const CHECKPOINT_ACTIONS = new Map([
  [24777, "10%"],
  [88057, "50%"]
]);
const CELEBRITY_USER_ID = "u0900";
const CELEBRITY_FOLLOWER_USER_ID = "u0901";
const CELEBRITY_FOLLOWER_FOLLOWING = Object.freeze([
  "u0001",
  "u0002",
  "u0003",
  "u0004",
  CELEBRITY_USER_ID
]);
const CELEBRITY_FOLLOWER_COUNT = 900;
const CELEBRITY_POST_COUNT = 200;
const personas = JSON.parse(readFileSync(join(ROOT, "personas.json"), "utf8"));

function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function makeClock() {
  let tick = 0;
  return function timestamp() {
    const value = new Date(EPOCH_MS + tick * 1000).toISOString().replace(".000Z", "Z");
    tick += 1;
    return value;
  };
}

function quote(value) {
  return JSON.stringify(String(value));
}

function action(clock, actor, verb, ...args) {
  return `${clock()} ${actor} ${verb} ${args.join(" ")}`;
}

function render(lines) {
  return `${lines.join("\n")}\n`;
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function pad(number, width) {
  return String(number).padStart(width, "0");
}

function scaleUser(number) {
  return `u${pad(number, 4)}`;
}

function starterSegments() {
  const clock = makeClock();
  const m1 = [];
  const m2 = [];
  const m3 = [];

  for (const persona of personas.starter) {
    m1.push(action(clock, persona.id, "register", persona.email, quote(persona.password)));
    const profile = persona.profile;
    m1.push(
      action(
        clock,
        persona.id,
        "profile-set",
        quote(profile.displayName),
        profile.handle,
        quote(profile.bio),
        quote(profile.location),
        profile.link,
        profile.avatar
      )
    );
  }

  const followEdges = [
    ["alice", "bob"],
    ["alice", "carol"],
    ["bob", "alice"],
    ["bob", "dave"],
    ["carol", "alice"],
    ["dave", "erin"],
    ["erin", "alice"],
    ["erin", "frank"],
    ["frank", "grace"],
    ["grace", "alice"],
    ["henry", "bob"],
    ["henry", "grace"]
  ];
  for (const [actorId, target] of followEdges) {
    m2.push(action(clock, actorId, "follow", target, "set", `mf-${actorId}-${target}`));
  }

  const starterPostBodies = [
    "Coffee time at the corner table https://example.com/cafe",
    "Two colors from this morning's walk.",
    "A five-second hello from the lake.",
    "Fresh bread, still warm.",
    "Bike route notes for Saturday.",
    "Small tools should have sharp edges.",
    "The blue glaze finally worked.",
    "Studio shelf before cleanup.",
    "A quiet clip from class.",
    "Tonight's set starts at eight.",
    "Trail conditions: dry and windy.",
    "Noodles worth crossing town for.",
    "Basil has officially taken over.",
    "Sketching a calmer settings screen.",
    "Three interface details I keep noticing.",
    "Beans, tomatoes, and too much garlic.",
    "Data cleanup can be satisfying.",
    "Sunday lunch test number four.",
    "The tomatoes are showing off.",
    "A graphic novel with perfect pacing.",
    "Questions for the garden club.",
    "A history episode for the train ride.",
    "Pickup game moved to six.",
    "Brooklyn looked silver after rain."
  ];

  for (let index = 0; index < starterPostBodies.length; index += 1) {
    const actorId = personas.starter[Math.floor(index / 3)].id;
    const postId = `sp${pad(index + 1, 4)}`;
    if (index === 1 || index === 7 || index === 13 || index === 19) {
      const firstImage = (index % 6) + 1;
      const secondImage = ((index + 1) % 6) + 1;
      m2.push(
        action(
          clock,
          actorId,
          "post",
          postId,
          "images",
          quote(starterPostBodies[index]),
          `media/img-${pad(firstImage, 2)}.png,media/img-${pad(secondImage, 2)}.png`
        )
      );
    } else if (index === 2 || index === 8) {
      m2.push(action(clock, actorId, "post", postId, "video", quote(starterPostBodies[index]), "media/vid-01.mp4"));
    } else {
      m2.push(action(clock, actorId, "post", postId, "text", quote(starterPostBodies[index])));
    }
  }

  const replies = [
    ["bob", "sr0001", "sp0001", "Save me a cup."],
    ["carol", "sr0002", "sp0004", "That crust looks perfect."],
    ["alice", "sr0003", "sp0013", "I need your basil secrets."],
    ["grace", "sr0004", "sp0022", "Adding it to my queue."]
  ];
  for (const [actorId, replyId, parentId, text] of replies) {
    m2.push(action(clock, actorId, "reply", replyId, parentId, quote(text)));
  }

  const likes = [
    ["bob", "sp0001"],
    ["carol", "sp0001"],
    ["dave", "sp0004"],
    ["erin", "sp0007"],
    ["frank", "sp0013"],
    ["grace", "sp0016"],
    ["henry", "sp0019"],
    ["alice", "sp0022"]
  ];
  for (const [actorId, postId] of likes) {
    m2.push(action(clock, actorId, "like", postId, "set", `ml-${actorId}-${postId}`));
  }

  const reposts = [
    ["carol", "sp0001"],
    ["alice", "sp0004"],
    ["henry", "sp0013"],
    ["bob", "sp0019"]
  ];
  for (const [actorId, postId] of reposts) {
    m2.push(action(clock, actorId, "repost", postId, "set", `mr-${actorId}-${postId}`));
  }

  m3.push(action(clock, "alice", "dm-create", "d-alice-bob", "bob"));
  m3.push(action(clock, "alice", "group-create", "g-starter", "bob", quote("Weekend Plans"), quote("Coffee, a walk, and dinner.")));
  m3.push(action(clock, "alice", "member-add", "g-starter", "carol", "mm-g-starter-carol"));
  // Retain the removed membership event's timestamp hole so unchanged starter
  // messages preserve their frozen documentary coordinates.
  clock();

  const dmMessages = [
    ["alice", "sm0001", "Coffee after work?", null],
    ["bob", "sm0002", "Yes. Corner place?", "sm0001"],
    ["alice", "sm0003", "Exactly. Six thirty.", "sm0002"],
    ["bob", "sm0004", "I will bring the route map.", null],
    ["alice", "sm0005", "Perfect, see you there.", null],
    ["bob", "sm0006", "On my way.", "sm0005"]
  ];
  for (const [actorId, messageId, text, quotedId] of dmMessages) {
    const args = [messageId, "d-alice-bob", quote(text)];
    if (quotedId) args.push(`quote=${quotedId}`);
    m3.push(action(clock, actorId, "send", ...args));
  }

  const groupMessages = [
    ["alice", "sm0007", "Saturday plan: coffee, lake, then noodles.", null],
    ["carol", "sm0008", "Coffee is a definite yes.", "sm0007"],
    ["carol", "sm0009", "I can meet everyone at ten.", null],
    ["bob", "sm0010", "The west trail is dry now.", null],
    ["alice", "sm0011", "West trail it is.", "sm0010"],
    ["carol", "sm0012", "I will bring snacks.", null],
    ["carol", "sm0013", "Should I book dinner?", null],
    ["bob", "sm0014", "Please do, for three.", "sm0013"],
    ["alice", "sm0015", "Locked in. See you Saturday.", null]
  ];
  for (const [actorId, messageId, text, quotedId] of groupMessages) {
    const args = [messageId, "g-starter", quote(text)];
    if (quotedId) args.push(`quote=${quotedId}`);
    m3.push(action(clock, actorId, "send", ...args));
  }

  if (m1.length !== 16 || m2.length !== 52 || m3.length !== 18) {
    throw new Error(`starter action count drift: ${m1.length}/${m2.length}/${m3.length}`);
  }
  return { m1, m2, m3 };
}

function sampleLines() {
  const clock = makeClock();
  const lines = [];
  const add = (actor, verb, ...args) => lines.push(action(clock, actor, verb, ...args));

  for (const [id, display, handle, avatar] of [
    ["sample-a", "Sample Ada", "sama", "media/avatar-alice.png"],
    ["sample-b", "Sample Ben", "samb", "media/avatar-bob.png"],
    ["sample-c", "Sample Cora", "samc", "media/avatar-alice.png"],
    ["sample-d", "Sample Dev", "samd", "media/avatar-bob.png"]
  ]) {
    add(id, "register", `${id}@example.com`, quote("Sample!Clique2026"));
    add(id, "profile-set", quote(display), handle, quote(`Conformance profile ${id}.`), quote("Fixture City"), `https://example.com/${id}`, avatar);
  }

  add("sample-a", "follow", "sample-b", "set", "sample-mut-follow-01");
  add("sample-a", "follow", "sample-c", "set", "sample-mut-follow-02");
  add("sample-a", "follow", "sample-c", "clear", "sample-mut-follow-03");
  add("sample-d", "follow", "sample-a", "set", "sample-mut-follow-04");

  add("sample-a", "post", "sample-post-01", "text", quote("Coffee conformance text."));
  add("sample-b", "post", "sample-post-02", "images", quote("One image."), "media/img-01.png");
  add("sample-c", "post", "sample-post-03", "images", quote("Four images."), "media/img-02.png,media/img-03.png,media/img-04.png,media/img-05.png");
  add("sample-d", "post", "sample-post-04", "video", quote("Video conformance."), "media/vid-01.mp4");
  add("sample-a", "post", "sample-post-05", "text", quote("Second text post."));
  add("sample-b", "post", "sample-post-06", "text", quote("Third text post."));
  add("sample-c", "post", "sample-post-07", "images", quote("Two images."), "media/img-05.png,media/img-06.png");
  add("sample-d", "post", "sample-post-08", "video", quote("Second video."), "media/vid-01.mp4");

  add("sample-b", "like", "sample-post-01", "set", "sample-mut-like-01");
  add("sample-c", "like", "sample-post-01", "set", "sample-mut-like-02");
  add("sample-b", "like", "sample-post-01", "clear", "sample-mut-like-03");
  add("sample-d", "like", "sample-post-04", "set", "sample-mut-like-04");
  add("sample-b", "repost", "sample-post-01", "set", "sample-mut-repost-01");
  add("sample-b", "repost", "sample-post-01", "clear", "sample-mut-repost-02");
  add("sample-c", "repost", "sample-post-04", "set", "sample-mut-repost-03");

  add("sample-b", "reply", "sample-reply-01", "sample-post-01", quote("First reply."));
  add("sample-c", "reply", "sample-reply-02", "sample-post-01", quote("Second reply."));
  add("sample-d", "reply", "sample-reply-03", "sample-post-04", quote("Video reply."));
  add("sample-a", "reply", "sample-reply-04", "sample-post-06", quote("Final reply."));

  add("sample-a", "dm-create", "sample-dm-01", "sample-b");
  add("sample-a", "group-create", "sample-group-01", "sample-b", quote("Conformance Group"), quote("Every messaging verb."));
  add("sample-a", "member-add", "sample-group-01", "sample-c", "sample-mut-member-01");
  add("sample-a", "member-add", "sample-group-01", "sample-d", "sample-mut-member-02");

  add("sample-a", "send", "sample-msg-01", "sample-dm-01", quote("DM one."));
  add("sample-b", "send", "sample-msg-02", "sample-dm-01", quote("DM quoted."), "quote=sample-msg-01");
  add("sample-a", "send", "sample-msg-03", "sample-group-01", quote("Group one."));
  add("sample-c", "send", "sample-msg-04", "sample-group-01", quote("Group quoted."), "quote=sample-msg-03");
  add("sample-d", "send", "sample-msg-05", "sample-group-01", quote("Group plain."));
  add("sample-b", "send", "sample-msg-06", "sample-group-01", quote("Another plain message."));
  add("sample-a", "send", "sample-msg-07", "sample-group-01", quote("Final quoted message."), "quote=sample-msg-06");

  add("sample-a", "send-media", "sample-msg-08", "sample-dm-01", "image", "media/img-03.png", quote("Normal photo."), "normal");
  add("sample-b", "send-media", "sample-msg-09", "sample-dm-01", "image", "media/img-04.png", quote("View once."), "view-once");
  add("sample-c", "send-media", "sample-msg-10", "sample-group-01", "video", "media/vid-01.mp4", quote("Normal video."), "normal");

  add("sample-b", "react", "sample-msg-01", quote("👍"), "sample-mut-react-01");
  add("sample-b", "react", "sample-msg-01", quote("❤️"), "sample-mut-react-02");
  add("sample-b", "react", "sample-msg-01", quote("none"), "sample-mut-react-03");
  add("sample-c", "react", "sample-msg-03", quote("🎉"), "sample-mut-react-04");
  add("sample-d", "react", "sample-msg-03", quote("🎉"), "sample-mut-react-05");

  if (lines.length !== 50) throw new Error(`sample must contain 50 actions, found ${lines.length}`);
  return lines;
}

function* scaleActionLines() {
  const clock = makeClock();
  const random = mulberry32(SEED);

  for (let number = 1; number <= 1000; number += 1) {
    const id = scaleUser(number);
    yield action(clock, id, "register", `${id}@example.com`, quote(personas.scale.password));
  }
  for (let number = 1; number <= 1000; number += 1) {
    const id = scaleUser(number);
    yield action(
      clock,
      id,
      "profile-set",
      quote(`Scale User ${pad(number, 4)}`),
      id,
      quote(`Deterministic scale fixture user ${pad(number, 4)}.`),
      quote("Fixture City"),
      `https://example.com/${id}`,
      number % 2 === 1 ? "media/avatar-alice.png" : "media/avatar-bob.png"
    );
  }

  const followEdges = new Set();
  const emitFollow = function* (actorId, target, mutationId) {
    followEdges.add(`${actorId}>${target}`);
    yield action(clock, actorId, "follow", target, "set", mutationId);
  };

  for (let number = 1; number <= 501; number += 1) {
    if (number === 500) continue;
    yield* emitFollow("u0500", scaleUser(number), `mf-u0500-${scaleUser(number)}`);
  }
  for (const target of ["u0001", "u0002", "u0003", "u0004", "u0006"]) {
    yield* emitFollow("u0005", target, `mf-u0005-${target}`);
  }
  const baselineFollowEdges = new Set(followEdges);

  // Keep the existing u0500 and u0005 comparison fixtures exact while making
  // the celebrity graph exact too. u0901's celebrity edge is included in the
  // 900; its four small-account edges complete the five-follow read fixture.
  for (let number = 1; number <= 903; number += 1) {
    if (number === 5 || number === 500 || number === 900) continue;
    const actorId = scaleUser(number);
    yield* emitFollow(actorId, CELEBRITY_USER_ID, `mf-${actorId}-${CELEBRITY_USER_ID}`);
  }
  for (const target of CELEBRITY_FOLLOWER_FOLLOWING) {
    if (target === CELEBRITY_USER_ID) continue;
    yield* emitFollow(
      CELEBRITY_FOLLOWER_USER_ID,
      target,
      `mf-${CELEBRITY_FOLLOWER_USER_ID}-${target}`
    );
  }

  const resolveExtendedRandomFollow = (actorNumber, targetNumber) => {
    for (let actorOffset = 0; actorOffset < 1000; actorOffset += 1) {
      const candidateActorNumber = ((actorNumber - 1 + actorOffset) % 1000) + 1;
      if ([5, 500, 901].includes(candidateActorNumber)) continue;
      for (let targetOffset = 0; targetOffset < 1000; targetOffset += 1) {
        const candidateTargetNumber = ((targetNumber - 1 + targetOffset) % 1000) + 1;
        if (candidateTargetNumber === 900 || candidateActorNumber === candidateTargetNumber) continue;
        const actorId = scaleUser(candidateActorNumber);
        const target = scaleUser(candidateTargetNumber);
        if (!followEdges.has(`${actorId}>${target}`)) return { actorId, target };
      }
    }
    throw new Error("could not place deterministic random follow edge");
  };

  let randomFollows = 0;
  while (randomFollows < 4500) {
    const actorNumber = 1 + Math.floor(random() * 1000);
    const targetNumber = 1 + Math.floor(random() * 1000);
    if (actorNumber === 5 || actorNumber === 500 || actorNumber === targetNumber) continue;
    const baselineKey = `${scaleUser(actorNumber)}>${scaleUser(targetNumber)}`;
    if (baselineFollowEdges.has(baselineKey)) continue;
    baselineFollowEdges.add(baselineKey);
    const { actorId, target } = resolveExtendedRandomFollow(actorNumber, targetNumber);
    followEdges.add(`${actorId}>${target}`);
    randomFollows += 1;
    yield action(clock, actorId, "follow", target, "set", `mf-${actorId}-${target}`);
  }

  yield action(clock, "u0001", "group-create", "g0001", "u0002", quote("Busy Group 0001"), quote("Fifty members and ten thousand messages."));
  for (let number = 3; number <= 49; number += 1) {
    const member = scaleUser(number);
    yield action(clock, "u0001", "member-add", "g0001", member, `mm-g0001-${member}`);
  }
  yield action(clock, "u0001", "member-add", "g0001", "u0500", "mm-g0001-u0500");

  for (let groupNumber = 2; groupNumber <= 100; groupNumber += 1) {
    const groupId = `g${pad(groupNumber, 4)}`;
    yield action(
      clock,
      "u0001",
      "group-create",
      groupId,
      "u0500",
      quote(`Probe Group ${pad(groupNumber, 4)}`),
      quote("Probe-user conversation membership fixture.")
    );
  }

  const dmOtherUsers = [];
  for (let number = 2; dmOtherUsers.length < 900; number += 1) {
    if (number === 500) continue;
    dmOtherUsers.push(scaleUser(number));
  }
  for (let dmNumber = 1; dmNumber <= 900; dmNumber += 1) {
    yield action(clock, "u0001", "dm-create", `d${pad(dmNumber, 4)}`, dmOtherUsers[dmNumber - 1]);
  }

  const busyMembers = [];
  for (let number = 1; number <= 49; number += 1) busyMembers.push(scaleUser(number));
  busyMembers.push("u0500");
  const words = ["coffee", "garden", "station", "weekend", "camera", "noodle", "silver", "signal"];
  const emojis = ["👍", "❤️", "🎉", "☕"];
  const likedPairs = new Set();
  const repostedPairs = new Set();
  const phases = [
    { label: "10%", topPosts: 4800, celebrityPosts: 20, replies: 200, likes: 500, reposts: 100, busyMessages: 1000, dmMessagesPerChat: 10, reactions: 200 },
    { label: "50%", topPosts: 24000, celebrityPosts: 100, replies: 1000, likes: 2500, reposts: 500, busyMessages: 5000, dmMessagesPerChat: 50, reactions: 1000 },
    { label: "100%", topPosts: 48000, celebrityPosts: 200, replies: 2000, likes: 5000, reposts: 1000, busyMessages: 10000, dmMessagesPerChat: 100, reactions: 2000 }
  ];
  let previous = { topPosts: 0, celebrityPosts: 0, replies: 0, likes: 0, reposts: 0, busyMessages: 0, dmMessagesPerChat: 0, reactions: 0 };

  // Each marker represents that fraction of every scalable content class,
  // after the fixed registration/graph/conversation setup. This makes the
  // 10% and 50% probe states genuine smaller corpora rather than phase-order
  // artifacts with (for example) zero messages.
  for (const phase of phases) {
    const regularPostsThisPhase = phase.topPosts - previous.topPosts;
    const celebrityPostsThisPhase = phase.celebrityPosts - previous.celebrityPosts;
    let celebrityPostsEmitted = 0;
    for (let postNumber = previous.topPosts + 1; postNumber <= phase.topPosts; postNumber += 1) {
      const actorNumber = 1 + Math.floor(random() * 1000);
      const actorId = scaleUser(actorNumber === 900 ? 899 : actorNumber);
      const postId = `p${pad(postNumber, 6)}`;
      const body = `Scale ${words[Math.floor(random() * words.length)]} dispatch ${pad(postNumber, 6)}.`;
      if (postNumber % 5000 === 0) {
        yield action(clock, actorId, "post", postId, "video", quote(body), "media/vid-01.mp4");
      } else if (postNumber % 1000 === 0) {
        const first = 1 + (postNumber / 1000) % 6;
        const second = 1 + ((postNumber / 1000) + 1) % 6;
        yield action(clock, actorId, "post", postId, "images", quote(body), `media/img-${pad(first, 2)}.png,media/img-${pad(second, 2)}.png`);
      } else {
        yield action(clock, actorId, "post", postId, "text", quote(body));
      }

      const regularPostsEmitted = postNumber - previous.topPosts;
      const celebrityTarget = Math.floor(
        (regularPostsEmitted * celebrityPostsThisPhase) / regularPostsThisPhase
      );
      while (celebrityPostsEmitted < celebrityTarget) {
        celebrityPostsEmitted += 1;
        const celebrityPostNumber = previous.celebrityPosts + celebrityPostsEmitted;
        yield action(
          clock,
          CELEBRITY_USER_ID,
          "post",
          `cp${pad(celebrityPostNumber, 6)}`,
          "text",
          quote(`Celebrity dispatch ${pad(celebrityPostNumber, 6)}.`)
        );
      }
    }

    for (let replyNumber = previous.replies + 1; replyNumber <= phase.replies; replyNumber += 1) {
      const actorNumber = 1 + Math.floor(random() * 1000);
      const actorId = scaleUser(actorNumber === 900 ? 899 : actorNumber);
      const parentNumber = 1 + Math.floor(random() * phase.topPosts);
      yield action(
        clock,
        actorId,
        "reply",
        `pr${pad(replyNumber, 6)}`,
        `p${pad(parentNumber, 6)}`,
        quote(`Scale direct reply ${pad(replyNumber, 6)}.`)
      );
    }

    while (likedPairs.size < phase.likes) {
      const actorId = scaleUser(1 + Math.floor(random() * 1000));
      const postId = `p${pad(1 + Math.floor(random() * phase.topPosts), 6)}`;
      const key = `${actorId}>${postId}`;
      if (likedPairs.has(key)) continue;
      likedPairs.add(key);
      yield action(clock, actorId, "like", postId, "set", `ml-${pad(likedPairs.size, 6)}`);
    }

    while (repostedPairs.size < phase.reposts) {
      const actorId = scaleUser(1 + Math.floor(random() * 1000));
      const postId = `p${pad(1 + Math.floor(random() * phase.topPosts), 6)}`;
      const key = `${actorId}>${postId}`;
      if (repostedPairs.has(key)) continue;
      repostedPairs.add(key);
      yield action(clock, actorId, "repost", postId, "set", `mr-${pad(repostedPairs.size, 6)}`);
    }

    for (let messageNumber = previous.busyMessages + 1; messageNumber <= phase.busyMessages; messageNumber += 1) {
      const actorId = busyMembers[(messageNumber - 1) % busyMembers.length];
      const messageId = `mg0001-${pad(messageNumber, 5)}`;
      if (messageNumber % 1000 === 0) {
        const imageNumber = 1 + (messageNumber / 1000) % 6;
        yield action(clock, actorId, "send-media", messageId, "g0001", "image", `media/img-${pad(imageNumber, 2)}.png`, quote(`Busy group image ${pad(messageNumber, 5)}.`), "normal");
      } else {
        const args = [messageId, "g0001", quote(`Busy group coffee signal ${pad(messageNumber, 5)}.`)];
        if (messageNumber > 1 && messageNumber % 250 === 0) {
          args.push(`quote=mg0001-${pad(messageNumber - 1, 5)}`);
        }
        yield action(clock, actorId, "send", ...args);
      }
    }

    for (let dmNumber = 1; dmNumber <= 900; dmNumber += 1) {
      const chatId = `d${pad(dmNumber, 4)}`;
      const otherUser = dmOtherUsers[dmNumber - 1];
      for (let messageNumber = previous.dmMessagesPerChat + 1; messageNumber <= phase.dmMessagesPerChat; messageNumber += 1) {
        const actorId = messageNumber % 2 === 1 ? "u0001" : otherUser;
        const messageId = `md${pad(dmNumber, 4)}-${pad(messageNumber, 3)}`;
        if (messageNumber === 100) {
          if (dmNumber % 10 === 0) {
            yield action(clock, actorId, "send-media", messageId, chatId, "video", "media/vid-01.mp4", quote(`DM video ${pad(dmNumber, 4)}.`), "normal");
          } else {
            const imageNumber = 1 + (dmNumber % 6);
            yield action(clock, actorId, "send-media", messageId, chatId, "image", `media/img-${pad(imageNumber, 2)}.png`, quote(`DM image ${pad(dmNumber, 4)}.`), "normal");
          }
        } else {
          const args = [messageId, chatId, quote(`DM ${pad(dmNumber, 4)} message ${pad(messageNumber, 3)} coffee.`)];
          if (messageNumber > 1 && messageNumber % 25 === 0) {
            args.push(`quote=md${pad(dmNumber, 4)}-${pad(messageNumber - 1, 3)}`);
          }
          yield action(clock, actorId, "send", ...args);
        }
      }
    }

    for (let reactionNumber = previous.reactions + 1; reactionNumber <= phase.reactions; reactionNumber += 1) {
      const actorId = busyMembers[(reactionNumber * 7) % busyMembers.length];
      const messageId = `mg0001-${pad(reactionNumber, 5)}`;
      yield action(clock, actorId, "react", messageId, quote(emojis[reactionNumber % emojis.length]), `mx-${pad(reactionNumber, 6)}`);
    }

    previous = phase;
  }
}

function* scaleLines() {
  let actionCount = 0;
  for (const line of scaleActionLines()) {
    actionCount += 1;
    yield line;
    const checkpoint = CHECKPOINT_ACTIONS.get(actionCount);
    if (checkpoint) yield `# checkpoint ${checkpoint}`;
  }
  if (actionCount !== SCALE_ACTION_COUNT) {
    throw new Error(`scale action count drift: expected ${SCALE_ACTION_COUNT}, got ${actionCount}`);
  }
}

function tokenizeGenerated(line) {
  const values = [];
  let cursor = 0;
  while (cursor < line.length) {
    while (line[cursor] === " " || line[cursor] === "\t") cursor += 1;
    if (cursor >= line.length) break;
    if (line[cursor] === '"') {
      const start = cursor;
      cursor += 1;
      let escaped = false;
      while (cursor < line.length) {
        if (escaped) escaped = false;
        else if (line[cursor] === "\\") escaped = true;
        else if (line[cursor] === '"') {
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      values.push(JSON.parse(line.slice(start, cursor)));
    } else {
      const start = cursor;
      while (cursor < line.length && line[cursor] !== " " && line[cursor] !== "\t") cursor += 1;
      values.push(line.slice(start, cursor));
    }
  }
  return values;
}

function newState() {
  return {
    users: new Map(),
    profiles: new Map(),
    follows: new Set(),
    posts: new Map(),
    conversations: new Map(),
    messages: new Map()
  };
}

function requireEntity(map, id, kind) {
  const entity = map.get(id);
  if (!entity) throw new Error(`manifest reducer could not find ${kind} ${id}`);
  return entity;
}

function applyLine(state, line) {
  const [timestamp, actorId, verb, ...args] = tokenizeGenerated(line);
  switch (verb) {
    case "register": {
      state.users.set(actorId, { id: actorId, email: args[0] });
      break;
    }
    case "profile-set": {
      state.profiles.set(actorId, {
        id: actorId,
        displayName: args[0],
        handle: args[1],
        bio: args[2],
        location: args[3],
        link: args[4],
        avatar: args[5]
      });
      break;
    }
    case "follow": {
      const key = `${actorId}>${args[0]}`;
      if (args[1] === "set") state.follows.add(key);
      else state.follows.delete(key);
      break;
    }
    case "post": {
      state.posts.set(args[0], {
        id: args[0],
        authorId: actorId,
        postType: args[1],
        text: args[2],
        media: args[3] ? args[3].split(",") : [],
        parentPostId: null,
        timestamp,
        likes: new Set(),
        reposts: new Set()
      });
      break;
    }
    case "like": {
      const post = requireEntity(state.posts, args[0], "post");
      if (args[1] === "set") post.likes.add(actorId);
      else post.likes.delete(actorId);
      break;
    }
    case "repost": {
      const post = requireEntity(state.posts, args[0], "post");
      if (args[1] === "set") post.reposts.add(actorId);
      else post.reposts.delete(actorId);
      break;
    }
    case "reply": {
      requireEntity(state.posts, args[1], "parent post");
      state.posts.set(args[0], {
        id: args[0],
        authorId: actorId,
        postType: "reply",
        text: args[2],
        media: [],
        parentPostId: args[1],
        timestamp,
        likes: new Set(),
        reposts: new Set()
      });
      break;
    }
    case "dm-create": {
      state.conversations.set(args[0], {
        id: args[0],
        type: "dm",
        name: null,
        description: null,
        members: new Set([actorId, args[1]])
      });
      break;
    }
    case "group-create": {
      state.conversations.set(args[0], {
        id: args[0],
        type: "group",
        name: args[2],
        description: args[3],
        members: new Set([actorId, args[1]])
      });
      break;
    }
    case "member-add": {
      requireEntity(state.conversations, args[0], "conversation").members.add(args[1]);
      break;
    }
    case "send": {
      requireEntity(state.conversations, args[1], "conversation");
      const quoteToken = args[3];
      const quoteId = quoteToken?.startsWith("quote=") ? quoteToken.slice("quote=".length) : null;
      if (quoteId) requireEntity(state.messages, quoteId, "quoted message");
      state.messages.set(args[0], {
        id: args[0],
        conversationId: args[1],
        senderId: actorId,
        messageType: "text",
        text: args[2],
        media: null,
        caption: null,
        viewOnce: false,
        quoteId,
        timestamp,
        reactions: new Map()
      });
      break;
    }
    case "send-media": {
      requireEntity(state.conversations, args[1], "conversation");
      state.messages.set(args[0], {
        id: args[0],
        conversationId: args[1],
        senderId: actorId,
        messageType: args[2],
        text: null,
        media: args[3],
        caption: args[4],
        viewOnce: args[5] === "view-once",
        quoteId: null,
        timestamp,
        reactions: new Map()
      });
      break;
    }
    case "react": {
      const message = requireEntity(state.messages, args[0], "message");
      if (args[1] === "none") message.reactions.delete(actorId);
      else message.reactions.set(actorId, args[1]);
      break;
    }
    default:
      throw new Error(`manifest reducer does not implement ${verb}`);
  }
}

function countWhere(values, predicate) {
  let count = 0;
  for (const value of values) if (predicate(value)) count += 1;
  return count;
}

function sumSizes(values, field) {
  let count = 0;
  for (const value of values) count += value[field].size;
  return count;
}

function perUserCount(state, selector) {
  const output = {};
  for (const userId of state.users.keys()) output[userId] = selector(userId);
  return output;
}

function namedO5Fixtures(state) {
  if (!state.users.has("u0500")) return null;
  const group = requireEntity(state.conversations, "g0001", "busy group");
  const celebrityFollowerFollowing = [...state.follows]
    .filter((edge) => edge.startsWith(`${CELEBRITY_FOLLOWER_USER_ID}>`))
    .map((edge) => edge.slice(edge.indexOf(">") + 1))
    .sort();
  return {
    u0500: {
      followingCount: countWhere(state.follows, (edge) => edge.startsWith("u0500>")),
      conversationMembershipCount: countWhere(state.conversations.values(), (conversation) => conversation.members.has("u0500"))
    },
    u0005: {
      followingCount: countWhere(state.follows, (edge) => edge.startsWith("u0005>"))
    },
    [CELEBRITY_USER_ID]: {
      followerCount: countWhere(state.follows, (edge) => edge.endsWith(`>${CELEBRITY_USER_ID}`)),
      postCount: countWhere(
        state.posts.values(),
        (post) => post.authorId === CELEBRITY_USER_ID && post.parentPostId === null
      )
    },
    [CELEBRITY_FOLLOWER_USER_ID]: {
      followingCount: celebrityFollowerFollowing.length,
      following: celebrityFollowerFollowing
    },
    g0001: {
      memberCount: group.members.size,
      members: [...group.members].sort(),
      messageCount: countWhere(state.messages.values(), (message) => message.conversationId === "g0001")
    }
  };
}

function stateSummary(state) {
  const perChatMessageCounts = {};
  const perGroupMemberCounts = {};
  for (const [conversationId, conversation] of state.conversations) {
    perChatMessageCounts[conversationId] = 0;
    if (conversation.type === "group") perGroupMemberCounts[conversationId] = conversation.members.size;
  }
  for (const message of state.messages.values()) {
    perChatMessageCounts[message.conversationId] += 1;
  }

  return {
    perEntityCounts: {
      users: state.users.size,
      profiles: state.profiles.size,
      followEdges: state.follows.size,
      posts: state.posts.size,
      topLevelPosts: countWhere(state.posts.values(), (post) => post.parentPostId === null),
      replies: countWhere(state.posts.values(), (post) => post.parentPostId !== null),
      activeLikes: sumSizes(state.posts.values(), "likes"),
      activeReposts: sumSizes(state.posts.values(), "reposts"),
      conversations: state.conversations.size,
      dms: countWhere(state.conversations.values(), (conversation) => conversation.type === "dm"),
      groups: countWhere(state.conversations.values(), (conversation) => conversation.type === "group"),
      memberships: sumSizes(state.conversations.values(), "members"),
      messages: state.messages.size,
      textMessages: countWhere(state.messages.values(), (message) => message.messageType === "text"),
      mediaMessages: countWhere(state.messages.values(), (message) => message.messageType !== "text"),
      quotedReplies: countWhere(state.messages.values(), (message) => message.quoteId !== null),
      activeReactions: sumSizes(state.messages.values(), "reactions"),
      disappearingSettingsEnabled: 0
    },
    followEdgeCount: state.follows.size,
    perUserFollowingCounts: perUserCount(state, (userId) => countWhere(state.follows, (edge) => edge.startsWith(`${userId}>`))),
    perUserConversationCounts: perUserCount(
      state,
      (userId) => countWhere(state.conversations.values(), (conversation) => conversation.members.has(userId))
    ),
    perChatMessageCounts,
    perGroupMemberCounts,
    namedO5Fixtures: namedO5Fixtures(state)
  };
}

function postSpot(state, id) {
  const post = state.posts.get(id);
  if (!post) return null;
  return {
    id,
    authorId: post.authorId,
    postType: post.postType,
    text: post.text,
    media: post.media,
    parentPostId: post.parentPostId,
    activeLikeCount: post.likes.size,
    activeRepostCount: post.reposts.size,
    directReplyCount: countWhere(state.posts.values(), (candidate) => candidate.parentPostId === id)
  };
}

function messageSpot(state, id) {
  const message = state.messages.get(id);
  if (!message) return null;
  return {
    id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    messageType: message.messageType,
    text: message.text,
    media: message.media,
    caption: message.caption,
    viewOnce: message.viewOnce,
    quoteId: message.quoteId,
    reactions: [...message.reactions.entries()].map(([userId, emoji]) => ({ userId, emoji }))
  };
}

function conversationSpot(state, id) {
  const conversation = state.conversations.get(id);
  if (!conversation) return null;
  return {
    id,
    type: conversation.type,
    name: conversation.name,
    description: conversation.description,
    members: [...conversation.members].sort(),
    messageCount: countWhere(state.messages.values(), (message) => message.conversationId === id)
  };
}

function spotEntities(state, includeScale) {
  const profiles = ["alice", "bob"];
  const posts = ["sp0001", "sp0002"];
  const messages = ["sm0001", "sm0002", "sm0007", "sm0008"];
  const conversations = ["d-alice-bob", "g-starter"];
  if (includeScale) {
    profiles.push("u0005", "u0500", CELEBRITY_USER_ID, CELEBRITY_FOLLOWER_USER_ID);
    posts.push("p000001", "p048000", "pr000001", "cp000001", "cp000200");
    messages.push("mg0001-00001", "mg0001-10000", "md0001-001", "md0900-100");
    conversations.push("g0001", "g0100", "d0001", "d0900");
  }
  return {
    profiles: Object.fromEntries(profiles.filter((id) => state.profiles.has(id)).map((id) => [id, state.profiles.get(id)])),
    posts: Object.fromEntries(posts.map((id) => [id, postSpot(state, id)]).filter(([, value]) => value !== null)),
    messages: Object.fromEntries(messages.map((id) => [id, messageSpot(state, id)]).filter(([, value]) => value !== null)),
    conversations: Object.fromEntries(
      conversations.map((id) => [id, conversationSpot(state, id)]).filter(([, value]) => value !== null)
    )
  };
}

function generatedBy() {
  const source = readFileSync(fileURLToPath(import.meta.url));
  return {
    generator: "generate.mjs",
    generatorVersion: GENERATOR_VERSION,
    generatorSourceSha256: sha256(source),
    prng: "mulberry32",
    seed: SEED,
    timestampEpoch: "2026-01-01T00:00:00Z",
    wallClockSourcesForbidden: true
  };
}

function artifact(name, content, committed) {
  return {
    name,
    committed,
    sha256: sha256(content),
    byteCount: Buffer.byteLength(content),
    lineCount: content.endsWith("\n") ? content.slice(0, -1).split("\n").length : content.split("\n").length,
    actionCount: content.split("\n").filter((line) => line && !line.startsWith("#")).length
  };
}

function assertFullNamedFixtures(summary) {
  const named = summary.namedO5Fixtures;
  const failures = [];
  if (named.u0500.followingCount !== 500) failures.push(`u0500 follows ${named.u0500.followingCount}`);
  if (named.u0500.conversationMembershipCount !== 100) failures.push(`u0500 conversations ${named.u0500.conversationMembershipCount}`);
  if (named.u0005.followingCount !== 5) failures.push(`u0005 follows ${named.u0005.followingCount}`);
  if (named[CELEBRITY_USER_ID].followerCount !== CELEBRITY_FOLLOWER_COUNT) {
    failures.push(`${CELEBRITY_USER_ID} followers ${named[CELEBRITY_USER_ID].followerCount}`);
  }
  if (named[CELEBRITY_USER_ID].postCount !== CELEBRITY_POST_COUNT) {
    failures.push(`${CELEBRITY_USER_ID} posts ${named[CELEBRITY_USER_ID].postCount}`);
  }
  if (named[CELEBRITY_FOLLOWER_USER_ID].followingCount !== CELEBRITY_FOLLOWER_FOLLOWING.length) {
    failures.push(
      `${CELEBRITY_FOLLOWER_USER_ID} follows ${named[CELEBRITY_FOLLOWER_USER_ID].followingCount}`
    );
  }
  if (
    JSON.stringify(named[CELEBRITY_FOLLOWER_USER_ID].following) !==
    JSON.stringify(CELEBRITY_FOLLOWER_FOLLOWING)
  ) {
    failures.push(
      `${CELEBRITY_FOLLOWER_USER_ID} following list ${named[CELEBRITY_FOLLOWER_USER_ID].following.join(",")}`
    );
  }
  if (named.g0001.memberCount !== 50) failures.push(`g0001 members ${named.g0001.memberCount}`);
  if (named.g0001.messageCount !== 10000) failures.push(`g0001 messages ${named.g0001.messageCount}`);
  if (failures.length > 0) throw new Error(`named fixture drift: ${failures.join(", ")}`);
}

function generateManifests({ updateStarter = false } = {}) {
  const starter = starterSegments();
  const starterContents = {
    "starter-m1.log": render(starter.m1),
    "starter-m2.log": render(starter.m2),
    "starter-m3.log": render(starter.m3)
  };
  const sampleContent = render(sampleLines());
  const starterState = newState();
  for (const content of Object.values(starterContents)) {
    for (const line of content.trimEnd().split("\n")) applyLine(starterState, line);
  }

  const starterManifest = {
    schemaVersion: GENERATOR_VERSION,
    generatedBy: generatedBy(),
    stateBase: "empty backend plus starter-m1.log, starter-m2.log, starter-m3.log in that order",
    artifacts: Object.fromEntries(
      Object.entries(starterContents).map(([name, content]) => [name, artifact(name, content, true)])
    ),
    expectedState: stateSummary(starterState),
    namedSpotEntities: spotEntities(starterState, false)
  };

  const combinedState = starterState;
  const scaleHash = createHash("sha256");
  const checkpoints = {};
  let scaleLineCount = 0;
  let scaleActionCount = 0;
  for (const line of scaleLines()) {
    scaleLineCount += 1;
    scaleHash.update(`${line}\n`);
    if (line.startsWith("# checkpoint ")) {
      const label = line.slice("# checkpoint ".length);
      checkpoints[label] = {
        marker: line,
        scaleActionsApplied: scaleActionCount,
        scaleLinesConsumedIncludingMarker: scaleLineCount,
        scalePrefixSha256: scaleHash.copy().digest("hex"),
        expectedState: stateSummary(combinedState),
        namedSpotEntities: spotEntities(combinedState, true)
      };
    } else {
      applyLine(combinedState, line);
      scaleActionCount += 1;
    }
  }
  const scaleDigest = scaleHash.digest("hex");
  const finalSummary = stateSummary(combinedState);
  assertFullNamedFixtures(finalSummary);
  if (scaleActionCount !== SCALE_ACTION_COUNT || scaleLineCount !== SCALE_ACTION_COUNT + 2) {
    throw new Error(`scale line-count drift: ${scaleActionCount} actions, ${scaleLineCount} lines`);
  }
  if (finalSummary.perEntityCounts.users !== 1008) throw new Error("combined user count drift");
  if (finalSummary.perEntityCounts.posts !== 50228) throw new Error("combined post count drift");
  if (finalSummary.perEntityCounts.messages !== 100015) throw new Error("combined message count drift");

  const combinedManifest = {
    schemaVersion: GENERATOR_VERSION,
    generatedBy: generatedBy(),
    stateBase: "fresh backend plus all starter segments, followed by the derived scale log",
    artifacts: {
      ...Object.fromEntries(
        Object.entries(starterContents).map(([name, content]) => [name, artifact(name, content, true)])
      ),
      "sample-50.log": artifact("sample-50.log", sampleContent, true),
      "scale.log": {
        name: "scale.log",
        committed: true,
        sha256: scaleDigest,
        lineCount: scaleLineCount,
        actionCount: scaleActionCount,
        checkpointMarkerCount: 2,
        checkpointLineNumbers: {
          "10%": checkpoints["10%"].scaleLinesConsumedIncludingMarker,
          "50%": checkpoints["50%"].scaleLinesConsumedIncludingMarker
        }
      }
    },
    expectedState: finalSummary,
    namedSpotEntities: spotEntities(combinedState, true),
    checkpoints
  };

  const starterManifestPath = join(ROOT, "invariant-manifest-starter.json");
  if (updateStarter) {
    writeFileSync(starterManifestPath, `${JSON.stringify(starterManifest, null, 2)}\n`);
  }
  const committedStarterManifest = JSON.parse(readFileSync(starterManifestPath, "utf8"));
  for (const field of ["stateBase", "artifacts", "expectedState", "namedSpotEntities"]) {
    if (JSON.stringify(committedStarterManifest[field]) !== JSON.stringify(starterManifest[field])) {
      throw new Error(`starter manifest ${field} drifted; M8 must not alter starter output`);
    }
  }
  writeFileSync(join(ROOT, "invariant-manifest-combined.json"), `${JSON.stringify(combinedManifest, null, 2)}\n`);
  writeFileSync(join(ROOT, "scale-log.sha256"), `${scaleDigest}  scale.log\n`);
}

function writeStarter() {
  const starter = starterSegments();
  writeFileSync(join(ROOT, "starter-m1.log"), render(starter.m1));
  writeFileSync(join(ROOT, "starter-m2.log"), render(starter.m2));
  writeFileSync(join(ROOT, "starter-m3.log"), render(starter.m3));
}

function writeSample() {
  writeFileSync(join(ROOT, "sample-50.log"), render(sampleLines()));
}

async function streamScale() {
  for (const line of scaleLines()) {
    if (!process.stdout.write(`${line}\n`)) await once(process.stdout, "drain");
  }
}

function usage() {
  process.stderr.write(
    `usage: node ${basename(fileURLToPath(import.meta.url))} <starter|scale|sample|manifests> [--update-starter]\n`
  );
}

const command = process.argv[2];
try {
  if (command === "starter") writeStarter();
  else if (command === "sample") writeSample();
  else if (command === "manifests") {
    const updateStarter = process.argv[3] === "--update-starter";
    if (process.argv.length > (updateStarter ? 4 : 3)) throw new Error("unknown manifests argument");
    generateManifests({ updateStarter });
  }
  else if (command === "scale") await streamScale();
  else {
    usage();
    process.exitCode = 2;
  }
} catch (error) {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
}
