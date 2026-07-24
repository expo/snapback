import 'dart:io';

// Native build: read the process environment (simctl launch passes
// SIMCTL_CHILD_* variables through as plain names).
String envLookup(String name) => Platform.environment[name] ?? '';
