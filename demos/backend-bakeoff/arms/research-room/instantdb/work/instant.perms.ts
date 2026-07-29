const member = "auth.id in data.ref('room.members.$user.id')";
const questionMember = "auth.id in data.ref('question.room.members.$user.id')";

export default {
  "$users": {
    "allow": {
      "view": "auth.id == data.id"
    }
  },
  "$files": {
    "allow": {
      "view": "data.path.startsWith(auth.id + '/') || auth.id in data.ref('source.room.members.$user.id')",
      "create": "data.path.startsWith(auth.id + '/')",
      "delete": "data.path.startsWith(auth.id + '/')"
    }
  },
  "profiles": {
    "allow": {
      "view": "auth.id in data.ref('$user.id') || auth.id in data.ref('rooms.members.$user.id')",
      "create": "auth.id in data.ref('$user.id')",
      "update": "auth.id in data.ref('$user.id')",
      "delete": "false"
    }
  },
  "rooms": {
    "allow": {
      "view": "auth.id in data.ref('members.$user.id')",
      "create": "auth.id != null",
      "update": "auth.id in data.ref('members.$user.id')",
      "delete": "false"
    }
  },
  "sources": {
    "allow": {
      "view": member,
      "create": "auth.id in data.ref('owner.$user.id') && auth.id in data.ref('room.members.$user.id')",
      "update": "auth.id in data.ref('owner.$user.id')",
      "delete": "auth.id in data.ref('owner.$user.id')"
    }
  },
  "questions": {
    "allow": {
      "view": member,
      "create": "auth.id in data.ref('asker.$user.id') && auth.id in data.ref('room.members.$user.id')",
      "update": "auth.id in data.ref('room.members.$user.id')",
      "delete": "false"
    }
  },
  "progress": {
    "allow": {
      "view": questionMember,
      "create": "auth.id in data.ref('question.room.members.$user.id') && 'running' in data.ref('question.status')",
      "update": "false",
      "delete": "false"
    }
  },
  "answers": {
    "allow": {
      "view": member,
      "create": "auth.id in data.ref('room.members.$user.id')",
      "update": "auth.id in data.ref('room.members.$user.id')",
      "delete": "false"
    }
  },
  "effectAttempts": {
    "allow": {
      "view": questionMember,
      "create": "auth.id in data.ref('question.room.members.$user.id')",
      "update": "false",
      "delete": "false"
    }
  }
};
