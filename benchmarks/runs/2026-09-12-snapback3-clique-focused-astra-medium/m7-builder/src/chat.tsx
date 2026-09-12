import { acquire } from './acquire';
import React, { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useClientState, useQuery } from 'snapback3/react';
import { PollCompose, PollDisplay, ReactionPicker, ChatListRow, Composer, MessageBubble, InsightsSummary, InsightsBarList } from '../ui';
import { Shell, Button } from './screens';
import { client } from './client';
export function Chats() {
  const state = useClientState();
  const [selected, setSelected] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const inbox = useQuery('conversations.inbox', {
    c: cursor
  });
  const [insights, setInsights] = useState(false);
  useEffect(() => {
    setSelected(null);
    setCursor(null);
  }, [state.principal?.id]);
  return <Shell><Text style={{
      fontSize: 28
    }}>Clique · Text chats</Text><Button title={insights ? 'Chats' : 'Insights'} onPress={() => setInsights(!insights)} /><Button title="Log out" onPress={() => void client.auth.logout()} />{insights ? <Insights /> : <><Text testID="connection">{state.status}</Text><Button title="Acquire all authorized text histories" onPress={() => void acquire().catch(console.error)} /><Text testID="inbox-status">{inbox.complete ? 'Inbox ready' : 'Inbox unknown'}</Text>{(inbox.data as any[] ?? []).map(c => <ChatListRow key={c.id} title={c.name ?? c.id} identity={c.id} onPress={() => setSelected(c.id)} />)}{inbox.next && <Button title="Next conversations" onPress={() => setCursor(inbox.next!)} />}<Button title="First conversations" onPress={() => setCursor(null)} /><TextInput testID="conversation-id" placeholder="Conversation ID" onSubmitEditing={e => setSelected(e.nativeEvent.text)} />{selected && <History key={`${state.principal?.id}:${selected}`} conversationId={selected} />}</>}</Shell>;
}
function History({
  conversationId
}: {
  conversationId: string;
}) {
  const state = useClientState();
  const [c, setC] = useState<string | null>(null);
  const history = useQuery('messages.page', {
    conversationId,
    c
  });
  const newest = useQuery('messages.latest', {
    conversationId
  });
  const summary = useQuery(typeof window !== 'undefined' && new URL(window.location.href).searchParams.has('denyUnread') ? 'conversations.unavailable' : 'conversations.unread', {
    conversationId
  });
  const receipts = useQuery('messages.receipts', {
    conversationId
  });
  const settings = useQuery('conversations.settings', {conversationId});
  const [showSettings, setShowSettings] = useState(false);
  const [showPollCompose, setShowPollCompose] = useState(false);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [creatingPoll, setCreatingPoll] = useState(false);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [quote, setQuote] = useState<any>(null);
  const [reactionTarget, setReactionTarget] = useState<string | null>(null);
  const [error, setError] = useState('');
  const rows = (history.data ?? []) as any[];
  const last = rows.at(-1);
  useEffect(() => {
    if (history.complete && last && c === null && state.status === 'online') {
      const op = client.mutate('messages.viewed', {
        conversationId,
        through: last.serverTimestamp
      });
      void op.settled.catch(e => setError(String(e)));
    }
  }, [conversationId, last?.id, history.complete, state.status]);
  const sum = summary.data as any;
  const unread = summary.complete && sum?.recent?.length < 200 ? String(sum.recent.filter((m: any) => m.senderId !== state.principal?.id && m.serverTimestamp > (sum.viewedThrough ?? 0)).length) : 'Unknown';
  return <View style={{
    gap: 8
  }}><Text style={{
      fontSize: 22
    }} testID="selected-chat">{conversationId}</Text><Text testID="unread-state">{unread}</Text><Button title="Chat settings" onPress={() => setShowSettings(!showSettings)} />{showSettings && <View testID="sm-chatsettings"><Text>Messages</Text><Text testID="sm-chatsettings-messagecount">{settings.complete ? (settings.data as any)?.messageCount ?? 'Unknown' : 'Unknown'}</Text></View>}
    {(settings.data as any)?.kind === 'group' && <Button title="Poll" onPress={() => setShowPollCompose(!showPollCompose)} />}
    {showPollCompose && <PollCompose question={question} options={options} onChangeQuestion={setQuestion} onChangeOption={(i, text) => setOptions(options.map((o,n) => n===i ? text : o))} onAddOption={() => setOptions([...options,''])} onRemoveOption={i => setOptions(options.filter((_,n) => n!==i))} submitting={creatingPoll} onSubmit={async (q, os) => {
      setCreatingPoll(true);
      try {
        const operation=client.mutate('polls.create',{id:crypto.randomUUID(),conversationId,question:q,optionA:os[0],optionB:os[1],optionC:os[2]??null,optionD:os[3]??null});
        await operation.durable; setShowPollCompose(false); setQuestion(''); setOptions(['','']);
        const receipt=await operation.settled; if(receipt.state!=='committed')setError(JSON.stringify(receipt));
      } catch(e){setError(String(e));} finally{setCreatingPoll(false);}
    }} /> }{(newest.data as any[] ?? []).filter(m => !rows.some(r => r.id === m.id)).map(m => <View key={m.id} testID={"latest-" + m.id}><MessageBubble isMine={m.senderId === state.principal?.id} text={m.text} /></View>)}<Text testID="history-status">{history.complete ? 'History ready' : 'History unknown'}</Text><TextInput testID="history-search" placeholder="Search this acquired page" value={search} onChangeText={setSearch} />{rows.filter(m => m.text.toLowerCase().includes(search.toLowerCase())).map(m => {
      const others = (receipts.data as any[] ?? []).filter(r => r.userId !== m.senderId);
      const read = others.some(r => r.viewedThrough >= m.serverTimestamp),
        delivered = others.some(r => r.fetchedThrough >= m.serverTimestamp);
      return <View key={m.id} testID={'message-' + m.id}>{m.type === 'poll' && !m.tombstone ? <PollMessage message={m} conversationId={conversationId} /> : <MessageBubble isMine={m.senderId === state.principal?.id} text={m.text} senderName={m.senderId} showSender timestamp={String(m.serverTimestamp)} edited={m.edited} deleted={m.tombstone} receipt={read ? 'read' : delivered ? 'delivered' : 'sent'} quote={m.replyTo ? {
          senderName: 'Quoted message',
          excerpt: rows.find(x => x.id === m.replyTo)?.text ?? m.replyTo
        } : undefined} />}<Button title="Reply" onPress={() => setQuote(m)} /><Button title="Reactions" onPress={() => setReactionTarget(m.id)} />{reactionTarget === m.id && <Reactions messageId={m.id} conversationId={conversationId} />}</View>;
    })}{state.pending.filter(o => o.op === 'messages.send' && o.args.conversationId === conversationId && !rows.some(m => m.id === o.args.id)).map(o => <MessageBubble key={o.id} isMine text={String(o.args.text)} receiptPending receipt="sent" />)}{history.next && <Button title="Next history" onPress={() => setC(history.next!)} />}<Button title="First history" onPress={() => setC(null)} /><Button title="Refresh history" onPress={() => void client.watch('messages.page', {
      conversationId,
      c
    }).refresh()} />{quote && <Text>Reply to {quote.text}</Text>}<Composer variant="message" value={draft} onChangeText={setDraft} onSend={async text => {
      try {
        const op = client.mutate('messages.send', {
          id: crypto.randomUUID(),
          conversationId,
          text,
          replyTo: quote?.id ?? null
        });
        await op.durable;
        setDraft('');
        setQuote(null);
        const r = await op.settled;
        if (r.state !== 'committed') setError(JSON.stringify(r));
      } catch (e) {
        setError(String(e));
      }
    }} /><Text>{error}</Text></View>;
}
function Insights() {
  const today = Math.floor(Date.now() / 86400000);
  const data = useQuery('social.insights', {
    today
  });
  const d = data.data as any;
  return <View><Text>Starter Insights · bounded to 100 per aggregate</Text><Button title="Refresh Insights" onPress={() => void client.watch('social.insights', {
      today
    }).refresh()} />{data.complete && d ? <><InsightsSummary totals={[{
        label: 'Posts',
        value: d.posts
      }, {
        label: 'Likes received',
        value: d.likesReceived
      }, {
        label: 'Reposts received',
        value: d.repostsReceived
      }, {
        label: 'Replies received',
        value: d.repliesReceived
      }, {
        label: 'Followers',
        value: d.followers
      }, {
        label: 'Following',
        value: d.following
      }]} /><InsightsBarList days={Array.from({
        length: 7
      }, (_, n) => ({
        dayLabel: new Date((today - 6 + n) * 86400000).toISOString().slice(0, 10),
        posts: d['d' + (6 - n)],
        likesReceived: d['l' + (6 - n)]
      })) as any} /></> : <Text>Insights unknown</Text>}</View>;
}
function Reactions({
  messageId,
  conversationId
}: {
  messageId: string;
  conversationId: string;
}) {
  const state = useClientState();
  const r = useQuery('messages.reactions', {
    messageId,
    conversationId
  });
  const rows = (r.data ?? []) as any[];
  const mine = rows.find(x => x.userId === state.principal?.id);
  return <View><Text>{r.complete ? rows.map(x => x.emoji + ' ' + (x.userId === state.principal?.id ? 'You' : x.userId)).join(', ') : 'Reactions unknown'}</Text><ReactionPicker selectedEmoji={mine?.emoji} onPick={emoji => {
      void client.mutate('messages.setReaction', {
        messageId,
        emoji: mine?.emoji === emoji ? null : emoji
      }).settled;
    }} /></View>;
}

function PollMessage({message,conversationId}:{message:any;conversationId:string}) {
  const state=useClientState();
  const result=useQuery('polls.get',{conversationId,pollId:message.id});
  const [error,setError]=useState('');
  const data=result.data as any;
  const pending=state.pending.filter(o=>o.op==='polls.vote' && o.args.pollId===message.id).at(-1);
  if(!data)return <Text>Poll loading</Text>;
  const ids=['a','b','c','d'];
  const opts=ids.map(id=>({id,label:data.poll['option'+id.toUpperCase()],count:data[id]??0,mine:(pending?.args.optionId??data.mine)===id,pending:!!pending && pending.args.optionId===id})).filter(o=>o.label!=null);
  return <View><PollDisplay question={data.poll.question} options={opts} onVote={async i=>{
    try{const op=client.mutate('polls.vote',{pollId:message.id,optionId:opts[i].id});await op.durable;const receipt=await op.settled;if(receipt.state!=='committed')setError(JSON.stringify(receipt));}catch(e){setError(String(e));}
  }} /><Text>{error}</Text></View>;
}
