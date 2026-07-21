// chat-matrix Flutter cell: same product as the Expo/Exact/SwiftUI apps —
// pick an OpenRouter model, talk to it — reaching all four backends through
// the gateway's portable /rpc surface (like the SwiftUI and Exact cells).
// Keyboard handling rides Scaffold's default resizeToAvoidBottomInset.

import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'env_stub.dart' if (dart.library.io) 'env_io.dart';

const backends = ['snapback', 'convex', 'supabase', 'sqlite'];
const defaultModel = 'anthropic/claude-haiku-4.5';

String _env(String name) => envLookup(name);

// Autodemo mirrors the Expo/SwiftUI hook: send one scripted message shortly
// after launch so headless acceptance can drive the loop. Enabled either at
// build time (--dart-define=AUTODEMO=1) or at launch (SIMCTL_CHILD_CHAT_AUTODEMO).
// Note: on iOS the process environment is visible to `ps` but NOT to Dart's
// Platform.environment, so simctl SIMCTL_CHILD_* delivery does not work —
// use --dart-define at build time (native) or ?autodemo=1 URL params (web).
final bool autodemo = const String.fromEnvironment('AUTODEMO') == '1' ||
    _env('CHAT_AUTODEMO') == '1' ||
    Uri.base.queryParameters['autodemo'] == '1';

final String gatewayOrigin = () {
  const defined = String.fromEnvironment('CHAT_GATEWAY_ORIGIN');
  if (defined.isNotEmpty) return defined;
  final url = Uri.base.queryParameters['gateway'] ?? '';
  if (url.isNotEmpty) return url;
  final runtime = _env('CHAT_GATEWAY_ORIGIN');
  return runtime.isNotEmpty ? runtime : 'http://127.0.0.1:4470';
}();

final String initialBackend = () {
  const defined = String.fromEnvironment('CHAT_BACKEND');
  if (backends.contains(defined)) return defined;
  final url = Uri.base.queryParameters['backend'] ?? '';
  if (backends.contains(url)) return url;
  final runtime = _env('CHAT_BACKEND');
  return backends.contains(runtime) ? runtime : 'sqlite';
}();

class MessageRow {
  final String id;
  final String conversationId;
  final String role;
  final String content;
  final String status;

  MessageRow.fromJson(Map<String, dynamic> json)
      : id = json['_id'] as String,
        conversationId = json['conversationId'] as String,
        role = json['role'] as String,
        content = json['content'] as String,
        status = json['status'] as String;

  bool get isUser => role == 'user';
  bool get isBusy => status == 'pending' || status == 'streaming';
}

class Gateway {
  final Uri origin = Uri.parse(gatewayOrigin);

  Future<dynamic> rpc(String backend, String op, Map<String, dynamic> args) async {
    final response = await http.post(
      origin.replace(path: '/rpc'),
      headers: {'content-type': 'application/json'},
      body: jsonEncode({'backend': backend, 'op': op, 'args': args}),
    );
    final payload = jsonDecode(response.body) as Map<String, dynamic>;
    if (payload['ok'] != true) {
      throw Exception(payload['error'] ?? '$backend.$op failed');
    }
    return payload['value'];
  }

  Future<({List<String> featured, List<({String id, String name})> models})>
      modelCatalog() async {
    final response = await http.get(origin.replace(path: '/models'));
    final payload = jsonDecode(response.body) as Map<String, dynamic>;
    return (
      featured: (payload['featured'] as List).cast<String>(),
      models: [
        for (final entry in payload['models'] as List)
          (id: entry['id'] as String, name: (entry['name'] ?? entry['id']) as String),
      ],
    );
  }
}

String conversationTitle(String firstMessage) {
  final trimmed = firstMessage.trim().replaceAll(RegExp(r'\s+'), ' ');
  return trimmed.length <= 40 ? trimmed : '${trimmed.substring(0, 39)}…';
}

void main() {
  debugPrint('chat-matrix boot: autodemo=$autodemo backend=$initialBackend gateway=$gatewayOrigin');
  runApp(const ChatMatrixApp());
}

class ChatMatrixApp extends StatelessWidget {
  const ChatMatrixApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'ChatMatrix Flutter',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF3478F6)),
        scaffoldBackgroundColor: const Color(0xFFF4F4F6),
        useMaterial3: true,
      ),
      home: const ChatScreen(),
    );
  }
}

class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key});

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final gateway = Gateway();
  final draftController = TextEditingController();
  final composerFocus = FocusNode();

  String backend = initialBackend;
  String model = defaultModel;
  String? conversationId;
  List<MessageRow> messages = [];
  bool sending = false;
  String? lastError;
  Timer? pollTimer;

  @override
  void initState() {
    super.initState();
    pollTimer = Timer.periodic(const Duration(milliseconds: 700), (_) => _refresh());
    if (autodemo) {
      Timer(const Duration(seconds: 2), () {
        composerFocus.requestFocus();
        _send('Reply with one short sentence praising the $backend backend.');
      });
    }
  }

  @override
  void dispose() {
    pollTimer?.cancel();
    draftController.dispose();
    composerFocus.dispose();
    super.dispose();
  }

  Future<void> _refresh() async {
    final target = conversationId;
    if (target == null) return;
    try {
      final rows = await gateway.rpc(backend, 'listMessages', {'conversationId': target});
      if (!mounted || conversationId != target) return;
      setState(() {
        messages = [for (final row in rows as List) MessageRow.fromJson(row)];
        lastError = null;
      });
    } catch (error) {
      if (mounted) setState(() => lastError = '$error');
    }
  }

  Future<void> _send(String content) async {
    final trimmed = content.trim();
    if (trimmed.isEmpty || sending) return;
    setState(() => sending = true);
    draftController.clear();
    try {
      var target = conversationId;
      if (target == null) {
        target = await gateway.rpc(backend, 'createConversation', {
          'model': model,
          'title': conversationTitle(trimmed),
        }) as String;
        setState(() => conversationId = target);
      }
      await gateway.rpc(backend, 'sendMessage', {
        'conversationId': target,
        'content': trimmed,
      });
      await _refresh();
    } catch (error) {
      setState(() {
        lastError = '$error';
        draftController.text = trimmed;
      });
    } finally {
      if (mounted) setState(() => sending = false);
    }
  }

  void _newChat() => setState(() {
        conversationId = null;
        messages = [];
        lastError = null;
      });

  void _switchBackend(String next) {
    if (next == backend) return;
    setState(() => backend = next);
    _newChat();
  }

  Future<void> _pickModel() async {
    final selected = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (context) => ModelPickerSheet(gateway: gateway, current: model),
    );
    if (selected != null && selected != model) {
      setState(() => model = selected);
      _newChat();
    }
  }

  @override
  Widget build(BuildContext context) {
    final reversed = messages.reversed.toList();
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            _header(),
            Expanded(
              child: reversed.isEmpty
                  ? _emptyState()
                  : ListView.separated(
                      reverse: true,
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      itemCount: reversed.length,
                      separatorBuilder: (_, _) => const SizedBox(height: 8),
                      itemBuilder: (context, index) => MessageBubble(message: reversed[index]),
                    ),
            ),
            if (lastError != null)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Text(lastError!,
                    style: const TextStyle(color: Colors.red, fontSize: 12)),
              ),
            _composer(),
          ],
        ),
      ),
    );
  }

  Widget _header() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: 6,
            children: [
              for (final candidate in backends)
                ChoiceChip(
                  label: Text(candidate),
                  selected: backend == candidate,
                  onSelected: (_) => _switchBackend(candidate),
                  showCheckmark: false,
                ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Flexible(
                child: OutlinedButton(
                  onPressed: _pickModel,
                  child: Text(model, overflow: TextOverflow.ellipsis),
                ),
              ),
              const Spacer(),
              Text('built with Flutter',
                  style: TextStyle(fontSize: 11, color: Colors.grey.shade500)),
              TextButton(onPressed: _newChat, child: const Text('＋ New')),
            ],
          ),
        ],
      ),
    );
  }

  Widget _emptyState() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(conversationId == null ? 'Chat via $backend' : 'No messages yet',
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),
          Text('Model: $model\nSay something to start the conversation.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 13, color: Colors.grey.shade600)),
        ],
      ),
    );
  }

  Widget _composer() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: TextField(
              controller: draftController,
              focusNode: composerFocus,
              minLines: 1,
              maxLines: 5,
              textInputAction: TextInputAction.send,
              onSubmitted: _send,
              decoration: InputDecoration(
                hintText: 'Message…',
                filled: true,
                fillColor: Colors.white,
                contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(20),
                  borderSide: BorderSide(color: Colors.grey.shade300),
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
          IconButton.filled(
            onPressed: sending ? null : () => _send(draftController.text),
            icon: const Icon(Icons.arrow_upward),
          ),
        ],
      ),
    );
  }
}

class MessageBubble extends StatelessWidget {
  final MessageRow message;
  const MessageBubble({super.key, required this.message});

  @override
  Widget build(BuildContext context) {
    final isUser = message.isUser;
    final color = message.status == 'error'
        ? const Color(0xFFFDECEC)
        : isUser
            ? const Color(0xFF3478F6)
            : Colors.white;
    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: BoxConstraints(
            maxWidth: MediaQuery.of(context).size.width * 0.84),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
        decoration: BoxDecoration(
          color: color,
          borderRadius: BorderRadius.circular(16),
        ),
        child: message.content.isEmpty && message.isBusy
            ? const SizedBox(
                width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
            : Text(
                message.status == 'streaming' ? '${message.content} ▍' : message.content,
                style: TextStyle(
                  fontSize: 15,
                  color: isUser ? Colors.white : const Color(0xFF1F1F24),
                ),
              ),
      ),
    );
  }
}

class ModelPickerSheet extends StatefulWidget {
  final Gateway gateway;
  final String current;
  const ModelPickerSheet({super.key, required this.gateway, required this.current});

  @override
  State<ModelPickerSheet> createState() => _ModelPickerSheetState();
}

class _ModelPickerSheetState extends State<ModelPickerSheet> {
  List<String> featured = [];
  List<({String id, String name})> all = [];
  String query = '';
  String? loadError;

  @override
  void initState() {
    super.initState();
    widget.gateway.modelCatalog().then((catalog) {
      if (mounted) {
        setState(() {
          featured = catalog.featured;
          all = catalog.models;
        });
      }
    }).catchError((Object error) {
      if (mounted) setState(() => loadError = '$error');
    });
  }

  List<({String id, String name})> get rows {
    final trimmed = query.trim().toLowerCase();
    if (trimmed.isEmpty) {
      final rest = all.where((entry) => !featured.contains(entry.id));
      return [for (final id in featured) (id: id, name: id), ...rest];
    }
    return [
      for (final entry in all)
        if (entry.id.toLowerCase().contains(trimmed) ||
            entry.name.toLowerCase().contains(trimmed))
          entry,
    ];
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: MediaQuery.of(context).size.height * 0.85,
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
            child: Row(
              children: [
                const Text('Choose a model',
                    style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
                const Spacer(),
                TextButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: const Text('Done'),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: TextField(
              autofocus: false,
              onChanged: (value) => setState(() => query = value),
              decoration: InputDecoration(
                hintText: 'Search models…',
                isDense: true,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
              ),
            ),
          ),
          if (loadError != null)
            Padding(
              padding: const EdgeInsets.all(12),
              child: Text('Model catalog unavailable: $loadError',
                  style: const TextStyle(color: Colors.red, fontSize: 13)),
            ),
          Expanded(
            child: ListView.builder(
              itemCount: rows.length,
              itemBuilder: (context, index) {
                final entry = rows[index];
                return ListTile(
                  dense: true,
                  title: Text(entry.id),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (featured.contains(entry.id))
                        const Text('★', style: TextStyle(color: Colors.orange)),
                      if (entry.id == widget.current)
                        const Icon(Icons.check, size: 18, color: Color(0xFF3478F6)),
                    ],
                  ),
                  selected: entry.id == widget.current,
                  onTap: () => Navigator.of(context).pop(entry.id),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
