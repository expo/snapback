"""Read-only evidence reduction. Semantic mappings below are manually authored."""
import json, hashlib, pathlib, datetime, collections, subprocess, os
OUT=pathlib.Path(os.environ.get('SECP_AUDIT_DIR','/tmp/secp-evidence'))
HOME=pathlib.Path.home()
SELECTED={'N_EDIT_AFTER_APPROVAL','N_GUARD_NOT_CONSUMED','N_LOOKUP_FILTERED','N_ARGUMENT_GRANT','N_SWEEP_DEADLINE','N_DEPENDENT_WINDOW','N_QUERY_FILTERED'}
D={}
def add(w,l,f,condition,ranges,exact,broad,rationale,aspect=None):
    D[f'w{w}-{l}{f}']=dict(condition=condition,ranges=ranges,exact=exact,broad=broad,rationale=rationale,coverage_aspect=aspect or condition)
def s(code,line=None,contains=None):return (code,line,contains)
add(26,'002','F1','Six-month prescription age uses month buckets rather than an exact elapsed/anniversary window.',[(89,96)],
 [s('N_CALENDAR_DURATION',95)],[],
 'The calendar question names orderGarment and the loss of day-of-month precision in month() arithmetic. It asks about the same prescription-window encoding. This does not validate the calibration note\'s older description of month() as month numbers alone.')
add(26,'008','F1','advanceWall does not require its parent job to have an accepted estimate or be in progress.',[(133,157)],
 [s('N_DERIVED_WRITE_AUTHORITY',151,'walls.stage')],[s('N_ROLE_WIDE_READ',40)],
 'The derived walls.stage question explicitly requires .job.status accepted/in_progress. The broad read-audience question has no such write prerequisite.')
add(26,'008','F2','finishJob does not require every child wall to have its finish coat.',[(146,157)],
 [s('N_DERIVED_WRITE_AUTHORITY',157,'count(walls')],[s('N_EDIT_AFTER_APPROVAL',157),s('N_CHILD_EVIDENCE_PRESENCE',138)],
 'The inferred effect prerequisite names finished jobs and unfinished walls for that job. The edit question concerns generic editability; the child-evidence question concerns photos rather than finished walls.')
add(26,'018','F1','addRescan omits the restricted-herd approval checked by addScan.',[(172,199)],
 [s('N_DERIVED_WRITE_AUTHORITY',182,'rescans.insert')],[s('N_GUARD_NOT_CONSUMED',191)],
 'The derived rescans.insert prerequisite follows scan.visit.herd.restricted to approvals[visit = .scan.visit.id], naming the missing approval on the rescan path. Its emitted site is the sibling addScan write at 182; the target and expression, rather than the shared site, establish relevance. Role/result reuse advice at addRescan does not name the missing approval.')
add(26,'018','F2','addRescan lacks a lower bound on server time relative to the original visit, allowing a rescan before a future visit.',[(184,191)],
 [],[s('N_GUARD_NOT_CONSUMED',191)],
 'The only time requirement is visitDate >= now - 30d. Neither role/result reuse nor filtered lookup advice asks whether now precedes visitDate; there is no exact baseline question.')
add(26,'020','F1','advanceStatus does not read routeApproved for a private-land trek.',[(104,126)],
 [s('N_APPROVAL_NOT_ENFORCED',108,'routeApproved')],[s('N_EDIT_AFTER_APPROVAL',108)],
 'The approval diagnostic names treks.routeApproved and the actual advanceStatus effect. The generic status-edit question is not the basis of coverage.')
add(26,'024','F1','The three required move photos are optional text references rather than verified uploads.',[(38,40),(90,93)],
 [s('N_TEXT_EVIDENCE',38),s('N_TEXT_EVIDENCE',39),s('N_TEXT_EVIDENCE',40)],[],
 'Each named photo column receives the explicit verified-upload-versus-text question. This retains the upload representation aspect of the calibrated finding; these messages do not independently ask whether the photos may be omitted.',
 'Verified uploaded photos versus text references; optionality itself is not named by these messages.')
add(26,'024','F2','recordVisit allows visitedAt earlier than movedAt because it checks only the upper 60-day bound.',[(110,115)],
 [s('N_CALLER_TIME',115,'visitedAt')],[s('N_GUARD_NOT_CONSUMED',115)],
 'The caller-time question explicitly identifies the one-sided visitedAt bound and asks about the missing side of the stored anchor. Status reuse concerns a different property.')
add(26,'025','F1','retest can reuse a failed prior exam to create multiple attempt-2 rows without consuming the prior exam.',[(166,183)],
 [s('N_DERIVED_WRITE_AUTHORITY',174,'.priorExam = null or count')],[s('N_EDIT_AFTER_APPROVAL',174),s('N_GUARD_NOT_CONSUMED',183)],
 'The repeat-create derived candidate limits child exams sharing .priorExam to one. That is the duplicate-retest condition, even though baseline N_GUARD_NOT_CONSUMED does not ask it at the insert. Advice about approveRetest retaining a failed status addresses the approval record, not reuse by retest.')
add(26,'025','F2','logExam can start another attempt-1 despite failed candidate history that requires manager approval.',[(129,132),(166,174)],
 [s('N_DERIVED_WRITE_AUTHORITY',174,'count(exams[candidate = .candidate]')],[s('N_EDIT_AFTER_APPROVAL',132,'attemptNo')],
 'The approval-history derived insert candidate ranges over this candidate\'s failed exams and missing approvals, including an unrestricted fresh logExam insert. It is not limited to the retest operation despite the seed site at 174. Generic attemptNo editability is not history/count coverage.')
add(26,'031','F1','scheduleCleaning bounds scheduledAt against now instead of the linked restaurant dueAt.',[(25,37),(73,80)],
 [s('N_DEPENDENT_WINDOW',79,'scheduledAt')],[s('N_EDIT_AFTER_APPROVAL',79,'scheduledAt')],
 'The dependent-window question names cleanings.scheduledAt and linked restaurants.dueAt, exactly the wrong-base/missing-deadline question. A generic edit question at the same insert is not a substitute.')
add(26,'033','F1','signFailing can withdraw customerConsent after approveSeal without clearing ownerApproved.',[(151,175)],
 [s('N_EDIT_AFTER_APPROVAL',155,'jobs.customerConsent'),s('N_DERIVED_WRITE_AUTHORITY',163,'jobs.customerConsent')],
 [s('N_GUARD_NOT_CONSUMED',173,'ownerApproved'),s('N_GUARD_NOT_CONSUMED',175,'ownerApproved')],
 'The baseline consent edit question and derived consent update candidate address changing approved input while ownerApproved stays true. The derived expression requires old.ownerApproved != true or next.ownerApproved != true. Approval reuse on advanceStatus is a different question. Loss of a particular selected diagnostic is recorded without calling the hole lost if the exact derived question remains.')
add(26,'033','F2','acceptQuote and advanceStatus can proceed with no photos child row.',[(134,148),(166,175)],
 [s('N_CHILD_EVIDENCE_PRESENCE',148,'attached photos[')],[],
 'The child-evidence question names the missing photos[job = parent].photo existence requirement and both affected transitions. The separate reports.photo question is not used.')
add(26,'033','F3','A new failing sign-off during sealing is not re-gated before the striped transition.',[(151,175)],
 [],[s('N_GUARD_NOT_CONSUMED',173,'ownerApproved'),s('N_GUARD_NOT_CONSUMED',175,'ownerApproved'),s('N_EDIT_AFTER_APPROVAL',173,'jobs.status'),s('N_EDIT_AFTER_APPROVAL',175,'jobs.status')],
 'Generic reuse/editability questions do not name rechecking approval after a new mid-sealing sign-off on the striped path. The derived customerConsent invalidation candidate covers F1, not the newly required sign-off/approval checkpoint in F3.')
add(26,'034','F1','Global serial uniqueness over private watches can reveal another owner\'s registered serial.',[(18,29)],
 [s('N_UNIQUE_HIDDEN',18,'global unique serial')],[],
 'The unique-hidden question explicitly names global serial uniqueness, omitted owner scope, and disclosure of another owner holding the value.')
add(26,'036','F1','advanceStage can progress a casting without reading modelApprovedAt.',[(98,127)],
 [s('N_APPROVAL_NOT_ENFORCED',116,'modelApprovedAt')],[s('N_EDIT_AFTER_APPROVAL',116)],
 'The approval diagnostic names the missing modelApprovedAt read and advanceStage. This retains the approval prerequisite question, not a separate proof of the 60-day cancellation policy.')
add(26,'045','F1','decideClaim accepts a whitespace crew-lead assessment because assessment is only compared with empty text.',[(152,160)],
 [s('N_BLANK_TEXT_GUARD',160)],[],
 'The blank-text question names decideClaim and whitespace passing an empty-text assessment check, the precise missing nonblank condition.')
add(26,'046','F1','installPart can install a backup without the separately authorized backupApprovals record/consent.',[(144,158)],
 [s('N_APPROVAL_NOT_ENFORCED',158,'backupApprovals.job')],[s('N_APPROVAL_INFORMATIONAL',158),s('N_GUARD_NOT_CONSUMED',158)],
 'The approval-table diagnostic says a separately authorized approval for jobs is recorded but a modeled effect does not require it. In this source installPart is the part-install effect and never probes backupApprovals. It retains the approval-enforcement question, without inferring a backup-name gate or proving consent validity.')
add(26,'049','F1','A signed contract image is readable by DJs even though phone, price and deposit columns are hidden from them.',[(24,39)],
 [s('N_MEDIA_PRIVATE_FIELDS',34,'bookings.contract')],[s('N_INVARIANT_RESTATES_RULE',44)],
 'The media-private-fields question names the contract scan and the broader audience than deposit, phone and price. The general bookings audience question alone would not identify information carried inside the image.')
# Wave 28
add(28,'011','F1','recordInstallation omits indoorMount/indoorApproved owner-approval gating.',[(93,118),(128,140)],
 [s('N_APPROVAL_NOT_ENFORCED',102,'indoorApproved')],[s('N_EDIT_AFTER_APPROVAL',118)],
 'The diagnostic names indoorApproved but its message/site misleadingly call the effect acceptQuote at 102. The supplied gate metadata explicitly carries candidate `invariant installs.recordInstallation only (not .indoorMount or .indoorApproved)`, so the same relevant installation question is present. Only that question expression is used; no witness, reachability or gate-coverage claim is made.')
add(28,'011','F2','openInstall accepts an unvalidated homeowner principal, letting the coordinator name itself and accept its quote.',[(93,103)],
 [s('N_ARGUMENT_GRANT',95,'homeowner')],[s('N_EDIT_AFTER_APPROVAL',95,'homeowner')],
 'The argument-grant question names openInstall\'s direct homeowner write into the reader-grant column. It asks about validating exactly the principal that later satisfies inst.homeowner = viewer.')
add(28,'013','F1','requestLift ignores repaired-fittings/chief return-to-service approval and checks only inspection age and ownership.',[(111,134)],
 [],[s('N_CHILD_EVIDENCE_PRESENCE',108)],
 'The nearby child-evidence question requires inspections.tagPhoto before advanceSling/returnToService. It does not ask whether requestLift requires the chief\'s returns approval or in_service status. There is no exact baseline question.')
add(28,'013','F2','advanceSling received-to-examined omits the old-chain proof-test prerequisite present on logInspection.',[(87,108)],
 [],[s('N_CHILD_EVIDENCE_PRESENCE',108),s('N_GUARD_NOT_CONSUMED',93),s('N_EDIT_AFTER_APPROVAL',108)],
 'An inspection photo requirement is not the age/kind-dependent lastProofTestAt requirement. The standing kind guard reuse question and generic status edit question do not identify this sibling-path prerequisite.')
add(28,'015','F1','serviceBoard exposes other renters\' service events, including handledBy, to every renter role.',[(80,88),(118,119)],
 [s('N_BROAD_READ',86,'serviceEvents.read')],[],
 'The broad-read diagnostic is specific here: it names serviceEvents, enumerates renter among the admitted roles, and says every row is readable regardless of ownership. Those are the actual missing audience restriction and cross-renter rows, unlike generic lifecycle policy advice.')
add(28,'019','F1','setAccount upserts an existing balance, permitting a dispatcher to erase debt without owner-only writeOff and its audit record.',[(28,43),(66,72)],
 [s('N_INSERT_WRITE_INTENT',43,'accounts.balance')],[],
 'The write-intent diagnostic names the setAccount insert/upsert path for accounts.balance and explicitly compares it with writeOff\'s owner-only edit restriction. This retains the bypassed write-off authority question; it does not separately infer the missing audit row.')
add(28,'019','F2','advanceMove accepts skipped/reversed target statuses without a declared transition relation.',[(136,144)],
 [],[s('N_INVARIANT_RESTATES_RULE',169)],
 'The source setter has no source-to-target transition check. Audience invariants and tree certificate/read notes do not ask for allowed status edges; broad guarded-stage questions would not establish that coverage either.')
add(28,'023','F1','Required roof photos are optional text URLs rather than uploaded media.',[(40,45),(60,62)],
 [s('N_TEXT_EVIDENCE',44),s('N_TEXT_EVIDENCE',45)],[],
 'The questions name photo1/photo2 and whether verified uploaded media are required instead of text references. They retain the upload representation question, not an independent must-supply/optional-presence question.',
 'Verified uploaded roof photos versus text references; optionality itself is not named.')
add(28,'024','F1','scheduleVisit does not cap scheduledAt at movedAt + 60d; completing against caller time does not enforce the scheduled obligation.',[(139,152)],
 [],[s('N_CALLER_TIME',152)],
 'The only nearby time question is about completeVisit\'s one-sided completedAt bound. It does not ask whether scheduleVisit.scheduledAt must be <= movedAt + 60d; it cannot count as that missing schedule bound.')
add(28,'024','F2','completeVisit permits caller completedAt before movedAt and permits backdating because its bound is only above.',[(145,152)],
 [s('N_CALLER_TIME',152,'completedAt')],[],
 'The caller-time diagnostic names completedAt and the one-sided stored-anchor bound, asking about the missing opposite side. This retains the pre-move completion question; it is not proof that backdating or lateness is enforced.')
add(28,'032','F2','recordVisit accepts an unbounded caller at, including future-dated follow-ups that clear overdueFollowups.',[(72,74),(94,97)],
 [],[],
 'recordVisit stores caller at without a bound and overdueFollowups tests visit existence. No emitted baseline question names the at/server-time bound or future follow-up records; read-authority advice does not cover it.')
add(28,'036','F1','changeLikeness replaces likenessScan during clay_sculpt without invalidating likenessApproved/At.',[(20,34),(84,119)],
 [s('N_DERIVED_WRITE_AUTHORITY',90,'figures.likenessScan')],[s('N_EDIT_AFTER_APPROVAL',108,'likenessScan'),s('N_GUARD_NOT_CONSUMED',119,'likenessApproved')],
 'The derived likenessScan update candidates require clearing the old Boolean approval or approval timestamp when replacing the scan. Their seed site is approveLikeness at 90, but the target is scan updates, including changeLikeness at 98. Edit advice at the separate owner-only approveLikenessChange path and reuse advice at advanceStage are not used as substitutes.')
add(28,'036','F2','An overdue unapproved figure stays active until the scheduled daily cancelOverdue sweep runs.',[(75,80),(94,98),(158,166)],
 [],[s('N_ROLE_WIDE_READ',32)],
 'The source sweep is daily; active status can lag. There is no baseline sweep-window question on this condition. Broad read/lifecycle policy and unrelated likeness approval-invalidation questions do not ask about the lag.')
add(28,'043','F1','approveAmendment stores any requestedBy principal without validating who requested the amendment.',[(114,120)],
 [],[s('N_ROLE_WIDE_WRITE',119)],
 'The role-wide-write question asks whether any admitted role may write any certificate row and record themselves. It does not mention requestedBy, its unvalidated argument, or validation of the requesting principal.')
add(28,'043','F2','issueReport uses 730 fixed days for a nominal two-year certificate lifetime across leap years.',[(105,112)],
 [s('N_CALENDAR_DURATION',112,'730d')],[],
 'The calendar-duration question explicitly names expiresAt, 730d and the fixed-days-versus-calendar-anniversary distinction.')
add(28,'046','F1','A format character such as U+200B can serve as invisible consent for replacement approval.',[(69,74),(85,92)],
 [],[s('N_EDIT_AFTER_APPROVAL',92),s('N_GUARD_NOT_CONSUMED',74)],
 'No baseline diagnostic questions invisible/format-character consent or its text validation. Approval reuse and approved-value editability do not name that missing nonblank/content condition.')
add(28,'047','F1','Required trial photos are an optional list of text values and can be absent/null/empty.',[(22,27),(81,85)],
 [s('N_TEXT_EVIDENCE',25,'trialPhotos')],[],
 'The trialPhotos diagnostic asks whether uploaded media are required instead of text. This retains the representation aspect of the calibrated finding, not explicit nonempty-list enforcement.',
 'Uploaded trial-photo evidence versus text references; nonempty/required presence is not independently named.')
add(28,'050','F1','openVisit checks now, rather than scheduledAt, against lastServiceAt + 365d.',[(75,82)],
 [],[s('N_STALE_CREATION_CHECK',89,'lastServiceAt')],
 'The stale-creation question asks later repair/test transitions to recheck mutable lastServiceAt. It does not ask whether the caller\'s scheduledAt is bounded by lastServiceAt + 365d at openVisit.')
# Wave 30
add(30,'002','F1','The required referral scan is optional URL text and orderHelmet does not require it.',[(22,27),(57,60),(80,86)],
 [s('N_TEXT_EVIDENCE',25,'referralScan')],[],
 'The specific referralScan question asks whether verified uploaded media are required instead of text. This retains the upload representation question but does not independently ask whether omitted referralScan must block ordering.',
 'Verified referral upload versus text reference; required presence before ordering is not independently named.')
add(30,'004','F1','jobPrivate admits every coordinator instead of only the particular job\'s assigned coordinator.',[(25,27),(42,53),(96,98)],
 [],[s('N_INVARIANT_RESTATES_RULE',82,'jobPrivate.read')],
 'The invariant-restatement question describes coordinator role-wide admission with no row relationship and asks generally about audience. It never names jobs.coordinator or an assigned-coordinator equality. Under the required strict criterion this remains a relevant broad policy question, not exact assignment coverage.')
add(30,'006','F1','Free re-service entitlement is not carried through the workflow, so returnReel bills quotedPrice again.',[(126,148)],
 [],[s('N_EDIT_AFTER_APPROVAL',147),s('N_GUARD_NOT_CONSUMED',138)],
 'No baseline question names free re-service, invoices or duplicate billing on the second return. Status editability and repeated fault reports are different conditions.')
add(30,'010','F1','rebookTrip does not consume the cancelled trip, permitting repeat rebooking and a later refund.',[(159,171)],
 [s('N_GUARD_NOT_CONSUMED',165,'trips.status')],[],
 'The guard-not-consumed diagnostic identifies rebookTrip\'s unchanged source trips.status while inserting a new trip. That is the unconsumed entitlement question. It retains a question about repeat use without proving the rebook/refund exclusivity policy.')
add(30,'014','F1','Private project phone, venue contract and fee admit every lead instead of the project\'s own lead.',[(23,43)],
 [],[s('N_ROLE_WIDE_READ',31),s('N_INVARIANT_RESTATES_RULE',49),s('N_INVARIANT_RESTATES_RULE',50),s('N_INVARIANT_RESTATES_RULE',51)],
 'The protected-column audience questions name leads and all rows but ask only generic resource relationships/states; none names assignment to THIS project or the missing project-lead link. Listed as broad policy advice, excluded from exact retention counts.')
add(30,'014','F2','markTakenDown can run before the event because it only enforces now <= eventAt + 2d.',[(103,108)],
 [],[s('N_CALLER_TIME',86,'eventAt')],
 'The openProject caller-time warning asks whether the supplied eventAt is bounded against now. It does not ask markTakenDown to require now >= eventAt. It is not the same missing bound.')
add(30,'018','F1','pruneTouchup omits quarantine approval, permit and fee although pruneVisit checks it.',[(101,109),(161,176)],
 [],[s('N_DERIVED_WRITE_AUTHORITY',109),s('N_GUARD_NOT_CONSUMED',109,'quarantine')],
 'The derived candidate governs visits.status becoming pruned, not touchups.done becoming true in pruneTouchup. Advice about a standing quarantine guard on pruneVisit does not identify the missing guard on the sibling touchup path.')
add(30,'023','F1','openJob allows a long-run replacement scheduled before now because only its upper 14-day limit is checked.',[(101,105)],
 [],[s('N_EDIT_AFTER_APPROVAL',105),s('N_REFERENCE_UNCHECKED',105)],
 'No baseline question names scheduledAt\'s missing lower bound. Editability of jobs.status and reference existence for replacementFor are unrelated despite the identical insert site.')
add(30,'025','F1','logExam trusts caller attempt instead of deriving sitting count, enabling approval and fee/prior-history bypass.',[(91,110)],
 [],[s('N_APPROVAL_NOT_ENFORCED',152),s('N_EDIT_AFTER_APPROVAL',110)],
 'The approval diagnostic says a modeled effect lacks retest approval, but never names caller attempt, derivation from exam history or dishonest attempt labels. The source does check approval for attempt >= 3. A generic approval question does not cover the missing trusted counter.')
add(30,'025','F2','Retest approval is bound to candidate/priorExam rather than the intended next sitting and can be reused.',[(50,59),(91,110),(147,152)],
 [],[s('N_APPROVAL_NOT_ENFORCED',152),s('N_GUARD_NOT_CONSUMED',152)],
 'The generic approval-enforcement question does not name approval binding to the new attempt or invalidation after use. The guard-not-consumed question at approveRetest concerns a failed exam remaining failed while recording approval; it does not ask whether logExam reuses that approval across sittings.')
add(30,'030','F1','Required sound recordings are optional/empty and openStudy accepts no recordings.',[(30,35),(96,100)],
 [s('N_OPTIONAL_EVIDENCE',34,'recordings')],[],
 'The optional-evidence question names studies.recordings and explicitly states that omitted or empty media evidence is permitted.')
add(30,'030','F2','publishReport accepts measured status and can bypass the reviewed stage.',[(109,124)],
 [],[s('N_EDIT_AFTER_APPROVAL',123)],
 'The baseline edit question asks about status editability without a lifecycle/approval condition. It does not name the missing reviewed-only precondition or the measured-to-reported bypass. Guarded stages are not declared-transition coverage.')
add(30,'030','F3','recordings uses an unrestricted file type rather than requiring sound/audio MIME types.',[(30,35),(96,100)],
 [],[s('N_OPTIONAL_EVIDENCE',34)],
 'The recordings question concerns omitted/empty evidence, not accepted content types. Same column/site is insufficient: no baseline message asks for audio-only content or exclusion of text/plain.')
add(30,'033','F1','advanceJob topcoats a damp-signed slab without consulting dampApproved owner approval.',[(79,111)],
 [s('N_APPROVAL_NOT_ENFORCED',84,'dampApproved')],[s('N_EDIT_AFTER_APPROVAL',96)],
 'The message misleadingly seeds acceptQuote at 84, but the supplied gate metadata carries the exact candidate `invariant jobs.advanceJob only (not .dampSigned or .dampApproved)`. That actual question, not a witness-success or production-gate claim, establishes relevance to the calibrated advance path.')
add(30,'033','F2','acceptQuote and advanceJob can proceed without any required before-photos row.',[(74,97),(118,137)],
 [s('N_CHILD_EVIDENCE_PRESENCE',84,'attached photos[')],[],
 'The child-evidence question explicitly names photos[job = parent].image existence before acceptQuote and advanceJob. It does not prove photo counts or required photo categories.')
add(30,'035','F1','advanceStage accepts skipped/reversed stages and can jump inspection directly to finished.',[(92,112)],
 [],[s('N_EDIT_AFTER_APPROVAL',97)],
 'The baseline stage-editability question does not name any permitted source/destination edge, required cleaning/flameproofing sequence or inspection-to-finished skip. A generic lifecycle question cannot count as declared-transition coverage.')
add(30,'038','F1','A duplicate workshop row for the same owner gives a fresh debt scope and bypasses the credit hold.',[(14,24),(59,62),(83,109)],
 [],[s('N_GUARD_NOT_CONSUMED',95,'standing'),s('N_GUARD_NOT_CONSUMED',119,'standing'),s('N_DERIVED_WRITE_AUTHORITY',109,'pastDue'),s('N_DERIVED_WRITE_AUTHORITY',119,'pastDue'),s('N_EDIT_AFTER_APPROVAL',86)],
 'No baseline diagnostic asks whether workshop identity is duplicable per owner or whether debt must aggregate across duplicate workshop rows. Standing-order guard reuse and pastDue(.workshop) prerequisites remain scoped to the chosen row, so neither is duplicate-resource coverage.')

def sha_bytes(b):return hashlib.sha256(b).hexdigest()
def read_json(p):
    b=p.read_bytes()
    return json.loads(b),dict(path=str(p),sha256=sha_bytes(b),bytes=len(b))
def line_of(site):return site.get('line') if isinstance(site,dict) else int(site.rsplit(':',2)[-2])
def choose(record,selectors):
    hits=[]
    if record is None:return hits
    for kind in ('notes','gates'):
        for index,n in enumerate(record.get(kind,[])):
            if not any(n['code']==code and (line is None or line_of(n['site'])==line) and (contains is None or contains in n['message']) for code,line,contains in selectors):continue
            hit=dict(kind='advisory' if kind=='notes' else 'recorded_gate',collection=kind,index=index,code=n['code'],site=n['site'],message=n['message'],message_sha256=sha_bytes(n['message'].encode()),selected_secp_code=n['code'] in SELECTED)
            # Read the recorded candidate question only, never count replay/exploit results.
            if kind=='gates':
                q=n.get('witness',{}).get('candidate')
                if q:hit['attached_candidate_question']=q
                hit['gate_id']=n.get('id')
            hits.append(hit)
    return hits

def main():
    baseline_path=OUT/'before-default/results.json'
    baseline,baseline_prov=read_json(baseline_path)
    bm,bmp=read_json(OUT/'before-default/measurement.json')
    final_dir=pathlib.Path(os.environ.get('SECP_AFTER_DIR',str(OUT/'qualified-default')))
    final_manifest,final_manifest_prov=read_json(final_dir/'measurement.json') if (final_dir/'measurement.json').exists() else (None,None)
    final_aggregate,final_aggregate_prov=read_json(final_dir/'results.json') if (final_dir/'results.json').exists() else (None,None)
    calibration_prov=[];findings=[];lanes={};missing=[];errors=[]
    for w in (26,28,30):
        cal,cp=read_json(HOME/f'sb4-loop/wave{w}/analysis/calibration.json');calibration_prov.append(cp)
        for f in cal['findings']:
            if f.get('backend')!='snapback' or f.get('cal')=='d':continue
            key=f'w{w}-{f["lane"]}{f["id"]}';definition=D[key]
            matches=[r for r in baseline if r['wave']==w and r['lane'].startswith(f['lane']+'-')]
            assert len(matches)==1,(key,'baseline lane match',len(matches))
            before=matches[0];lane_key=f'w{w}-{before["lane"]}'
            if lane_key not in lanes:
                folder=HOME/f'sb4-loop/wave{w}/apps'/before['lane']/'snapback'
                qfiles=sorted(folder.glob('*.q'))
                texts=[(p.name,p.read_text()) for p in qfiles]
                bundle=sha_bytes(json.dumps(texts).encode())
                fp=final_dir/f'{lane_key}.json'
                after,ap=read_json(fp) if fp.exists() else (None,None)
                if after is None and final_aggregate is not None:
                    rs=[r for r in final_aggregate if r['wave']==w and r['lane']==before['lane']]
                    assert len(rs)==1
                    after=rs[0];ap=dict(aggregate=final_aggregate_prov,record_wave=w,record_lane=before['lane'])
                if after is None:missing.append(str(fp))
                assert bundle==before['sha256'],(key,'source/baseline hash mismatch')
                if after:
                    assert after['sha256']==bundle,(key,'source/candidate hash mismatch')
                    if final_aggregate is not None:
                        ar=next(r for r in final_aggregate if r['wave']==w and r['lane']==before['lane'])
                        assert ar==after,(key,'individual/aggregate mismatch')
                bfile=OUT/'before-default'/f'{lane_key}.json'
                bfp=None
                if bfile.exists():
                    br,bfp=read_json(bfile)
                    assert br==before,(key,'baseline individual/aggregate mismatch')
                lane=dict(wave=w,lane=before['lane'],source_directory=str(folder),source_bundle_sha256=bundle,baseline_source_bundle_sha256=before['sha256'],final_source_bundle_sha256=after['sha256'] if after else None,source_bundle_algorithm='SHA256(UTF-8 json.dumps(sorted [(top-level q.name, q.read_text())])); Python default JSON serialization',source_files=[dict(path=str(p),sha256=sha_bytes(p.read_bytes()),lines=len(p.read_text().splitlines())) for p in qfiles],baseline_result_file=bfp,final_result_file=ap,baseline_diagnostic_inventory=before['notes'],final_diagnostic_inventory=after['notes'] if after else None,baseline_gates=[{k:n[k] for k in ('code','site','message','id') if k in n}|({'attached_candidate_question':n['witness']['candidate']} if n.get('witness',{}).get('candidate') else {}) for n in before['gates']],final_gates=[{k:n[k] for k in ('code','site','message','id') if k in n}|({'attached_candidate_question':n['witness']['candidate']} if n.get('witness',{}).get('candidate') else {}) for n in after['gates']] if after else None)
                lanes[lane_key]=(lane,before,after)
            lane,before,after=lanes[lane_key]
            before_hits=choose(before,definition['exact']);after_hits=choose(after,definition['exact'])
            before_broad=choose(before,definition['broad']);after_broad=choose(after,definition['broad'])
            if key in ('w28-011F1','w30-033F1'):
                # The standalone approval message names the wrong effect. Only the
                # explicit attached transition candidate establishes exact relevance.
                before_broad += [n for n in before_hits if n['kind']=='advisory']
                after_broad += [n for n in after_hits if n['kind']=='advisory']
                before_hits=[n for n in before_hits if n['kind']=='recorded_gate']
                after_hits=[n for n in after_hits if n['kind']=='recorded_gate']
                expected='recordInstallation' if key=='w28-011F1' else 'advanceJob'
                for n in before_hits+after_hits:
                    assert expected in n.get('attached_candidate_question',''),(key,'candidate does not name affected transition')
                    n['relevance_basis']='Attached candidate question; standalone diagnostic message names acceptQuote and does not independently cover the calibrated transition.'
            # Explicit final-only additional exact question, manually checked against source.
            if key=='w26-025F1':after_hits+=choose(after,[s('N_GUARD_NOT_CONSUMED',174,'unchanged exams.status')])
            if key=='w28-036F2':after_hits+=choose(after,[s('N_SWEEP_DEADLINE',94,'cancelOverdue')])
            if definition['exact'] and not before_hits:errors.append(f'{key}: manual exact selector has no baseline match')
            classification='uncovered_before' if not before_hits else ('retained' if after_hits else ('lost_question' if after is not None else None))
            if before_hits:
                if classification=='retained':outcome='At least one exact, semantically relevant baseline question remains in the qualified candidate.'
                elif classification=='lost_question':outcome='LOSS: the baseline asked the actual missing condition; no same relevant question remains in the qualified candidate.'
                else:outcome='Baseline question identified; qualified candidate file is still pending. No retention verdict yet.'
            else:
                outcome='No baseline question names the actual missing condition; excluded from the retention denominator. Broad/nearby advice is listed separately.'
                if after_hits:outcome+=' The qualified candidate newly asks the condition; this is a final-only question, not retention.'
            source=pathlib.Path(lane['source_directory'])/'schema.q';lines=source.read_text().splitlines()
            excerpts=[dict(file=str(source),start_line=a,end_line=z,numbered_text='\n'.join(f'{i}: {lines[i-1]}' for i in range(a,min(z,len(lines))+1))) for a,z in definition['ranges']]
            for m in before_hits+after_hits: m['matched_condition']=definition['coverage_aspect']
            selected_before=[n for n in before_hits if n['selected_secp_code']]
            selected_after=[n for n in after_hits if n['selected_secp_code']]
            findings.append(dict(id=key,wave=w,lane=f['lane'],application=before['lane'],calibration=f,source_condition=definition['condition'],coverage_aspect=definition['coverage_aspect'],source_bundle_sha256=lane['source_bundle_sha256'],source_evidence=excerpts,baseline_matches=before_hits,final_matches=after_hits,broad_or_nearby_not_counted=dict(baseline=before_broad,final=after_broad),classification=classification,final_status='available' if after is not None else 'pending',rationale=definition['rationale']+(' The final N_SWEEP_DEADLINE at changeLikeness:94 now names the cancelOverdue window and sweep lag on the clay_sculpt write path. The analogous question at approveLikenessChange:103 is not counted: that separate non-clay path is not the calibrated overdue-unapproved clay_sculpt case.' if key=='w28-036F2' else ''),outcome=outcome,selected_code_relevant_baseline_matches=len(selected_before),selected_code_relevant_final_matches=len(selected_after),selected_question_disappeared_but_same_relevant_question_retained=bool(selected_before and not selected_after and after_hits)))
    assert len(findings)==54 and len(D)==54
    assert {f['id'] for f in findings}==set(D)
    assert not errors,errors
    counts=collections.Counter(f['classification'] or 'pending_final' for f in findings)
    by_wave={str(w):dict(collections.Counter(f['classification'] or 'pending_final' for f in findings if f['wave']==w)) for w in (26,28,30)}
    before_covered=sum(bool(f['baseline_matches']) for f in findings)
    meta=dict(generated_utc=datetime.datetime.now(datetime.timezone.utc).isoformat(),reviewer='Independent OpenAI Codex assistant in commissioned retention-audit session; no subagents',worktree='/home/ccheever/projects/sb4-b31-secp',worktree_head_observed=subprocess.check_output(['git','rev-parse','HEAD'],cwd='/home/ccheever/projects/sb4-b31-secp',text=True).strip(),baseline_aggregate=baseline_prov,qualified_final_aggregate=final_aggregate_prov,baseline_measurement=dict(file=bmp,contents=bm),qualified_final_measurement=dict(file=final_manifest_prov,contents=final_manifest),calibration_files=calibration_prov,audit_generator=dict(path=__file__,sha256=sha_bytes(pathlib.Path(__file__).read_bytes())),source_hashes_match_baseline_and_all_available_candidate_records=True,individual_and_aggregate_records_match_when_both_present=True)
    report=dict(audit='Independent SECP calibrated-hole question retention',status='complete' if not missing else 'baseline complete; waiting for qualified final lane files',provenance=meta,scope=dict(calibration_filter='backend == snapback AND cal != d',findings=54,findings_by_wave={'26':19,'28':18,'30':17},unique_application_lanes=len(lanes),selected_secp_codes=sorted(SELECTED),seven_selected_codes_are_non_gates=True,baseline_covered_findings=before_covered,exact_final_question_findings=sum(bool(f['final_matches']) for f in findings),final_only_question_findings=[f['id'] for f in findings if not f['baseline_matches'] and f['final_matches']],counts={k:counts.get(k,0) for k in ('retained','uncovered_before','lost_question','pending_final')},by_wave=by_wave,pending_final_files=missing),methodology=[
 'Independently read the calibrated source conditions and authored semantic mappings for all 54 findings. A match must name the actual missing condition on the affected resource/path, or carry an explicit attached candidate question that does. Same lane, same code, same line, generic lifecycle advice or a different sibling path never suffices.',
 'Question retention uses ANY supplied advisory or recorded gate, including non-selected codes. Recorded candidate expressions are questions only; no witness trace, exploit, reachability or production-gate coverage is counted.',
 'Broad policy and nearby questions that fail to name the actual missing condition are stored separately and excluded from exact baseline/final matches. Generic guarded-stage advice is not declared-transition coverage; standing-guard advice is not duplicate-resource coverage.',
 'Compound evidence findings may retain an actual upload-versus-text question without a separate required-presence question; the exact retained aspect and limitation are explicit for each such finding. Retained does not mean complete coverage of every subcondition.',
 'All supplied baseline and final lane notes are included verbatim in the JSON lane inventories; each match keeps its original collection index, message, site and message digest. Gates are reduced to code/site/message/id and candidate expression to avoid implying witness coverage.',
 'Sources, product and credentials were not modified or executed. No app commands, builds, tests or agents were run. The only writes are audit artifacts under /tmp/secp-evidence. Existing measurements were read as inputs.',
 'The repository read-only llp-orient skill was used for governing context: LLP 3000.036.004.001#6-presentation-and-acceptance requires the calibrated before/after inventory; LLP 3000.036.004 distinguishes advisory questions from authority/proof. No product or corpus changes are proposed.'
 ],limitations=[
 'This is a static question-retention audit of supplied outputs, not validation of every calibrated allegation, runtime authorization, exploit reachability, witness preservation, production gates or security completeness.',
 'The Integration27 exact M-hole gate-coverage result remains 1/14 for wave 30, solely 033F1, as supplied by the commissioning user. This audit does not recompute or increase that figure; question counts have a different unit and denominator.',
 'Broad assignment-audience advice for wave30 004F1 and 014F1 is deliberately excluded: it does not name the assigned coordinator/project-lead condition.',
 'Some source calibration line pointers are historical; report evidence and emitted diagnostic sites refer to the source bundle whose digest agrees with both supplied phases.',
 'The qualified aggregate may be absent while lane files are present. Per-lane verdicts bind the hashed individual files, not an unqualified earlier candidate. Completeness is explicitly reported.'
 ],findings=findings,lanes=[v[0] for v in lanes.values()])
    (OUT/'calibration-retention.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    write_markdown(report)
    print(json.dumps(dict(status=report['status'],counts=dict(counts),baseline_covered=before_covered,lanes=len(lanes),missing_final=len(missing),selected_code_disappearances_with_exact_alternative=[f['id'] for f in findings if f['selected_question_disappeared_but_same_relevant_question_retained']]),indent=2))

def fmt_site(site):
    return f"{site['file']}:{site['line']}:{site['col']}" if isinstance(site,dict) else site

def write_markdown(r):
    scope=r['scope'];counts=scope['counts'];prov=r['provenance'];ls=[]
    def p(x=''):ls.append(x)
    p('# Independent SECP calibrated-hole question retention')
    p();p(f"Status: **{r['status']}**. Generated {prov['generated_utc']}.")
    p();p(f"All **54** calibrated findings were reviewed: wave26 19, wave28 18, wave30 17, across {scope['unique_application_lanes']} source applications. **{scope['baseline_covered_findings']}** had an exact semantically relevant baseline question. Current result: **{counts.get('retained',0)} retained, {counts.get('lost_question',0)} lost_question, {counts.get('uncovered_before',0)} uncovered_before, {counts.get('pending_final',0)} pending_final**.")
    p();p('This measures questions only. It does not measure witnesses, exploits, runtime safety or production gates. **Integration27 wave30 exact M-hole gate coverage remains 1/14, solely 033F1.** The seven selected SECP codes are non-gates; matching may use any advisory or recorded question.')
    p();p('A retained finding means at least one question names the same actual missing condition. Generic guarded-stage advice does not cover missing transition edges; standing-guard advice does not cover duplicate-resource credit-hold bypass. Broad assignment-audience questions that do not name the assigned coordinator/project lead are listed separately. Upload-versus-text questions retain that aspect only, not automatically required-presence or nonempty-list checks.')
    p();p('| Wave | Findings | Exact baseline question | Retained | Lost | Uncovered before | Pending |')
    p('|---|---:|---:|---:|---:|---:|---:|')
    for w in (26,28,30):
        fs=[f for f in r['findings'] if f['wave']==w];c=scope['by_wave'][str(w)]
        p(f"| {w} | {len(fs)} | {sum(bool(f['baseline_matches']) for f in fs)} | {c.get('retained',0)} | {c.get('lost_question',0)} | {c.get('uncovered_before',0)} | {c.get('pending_final',0)} |")
    losses=[f for f in r['findings'] if f['classification']=='lost_question']
    if losses:
        p();p('Actual lost questions: '+', '.join(f['id'] for f in losses)+'. These are losses, with no broad-policy substitute counted.')
    else:
        p();p('No actual lost calibrated question was found in the available qualified files.' + (' Pending files still need comparison.' if scope['pending_final_files'] else ''))
    alt=[f['id'] for f in r['findings'] if f['selected_question_disappeared_but_same_relevant_question_retained']]
    if alt:
        p();p('Selected-code question disappearance with an exact alternative still present: '+', '.join(alt)+'. The per-finding evidence names the alternative; a different code/site alone is never sufficient.')
    new_final=scope['final_only_question_findings']
    if new_final:
        p();p('Final-only exact questions, still classified uncovered_before: '+', '.join(new_final)+'. They do not increase the retention denominator. In total '+str(scope['exact_final_question_findings'])+' findings have a relevant question after.')
    p();p('## Provenance and scope')
    p();p(f"Worktree `{prov['worktree']}`; observed HEAD `{prov['worktree_head_observed']}`. Only audit artifacts under `/tmp/secp-evidence` were written. No source application, product command, credential or other worktree was used as an executable or modified; no agents were spawned.")
    p();p('Inputs (SHA-256):')
    for x in [prov['baseline_aggregate'],prov['qualified_final_aggregate']]+prov['calibration_files']:
        if x:p(f"- `{x['path']}` — `{x['sha256']}`")
    if not prov['qualified_final_aggregate']:p('- Qualified aggregate is not yet present; verdicts bind hashed individual qualified lane files below.')
    for title,k in [('Baseline','baseline_measurement'),('Qualified final','qualified_final_measurement')]:
        x=prov[k]
        if x['file']:
            p(f"- {title} manifest `{x['file']['path']}` — `{x['file']['sha256']}`; measured binary SHA-256 `{x['contents']['binarySha256']}`.")
    p(f"- Audit generator `{prov['audit_generator']['path']}` — `{prov['audit_generator']['sha256']}`.")
    p();p('Every source bundle equals the baseline and available final record’s `sha256`. Bundle recipe: SHA-256 of UTF-8 Python `json.dumps(sorted [(q.name, q.read_text()) for top-level *.q])`, default serialization. Individual source-file hashes, result-file hashes, unchanged-source verification, complete diagnostic inventories and all exact messages are in the JSON. Both individual/aggregate records were compared when both existed.')
    p();p('Governing read-only context: `skills/llp-orient/SKILL.md`; Snapback4 fence/LLP 3000; LLP 3000.036.004.001 §6 and LLP 3000.036.004. No document changes or runtime claims follow from this audit.')
    p();p('## All findings')
    for f in r['findings']:
        p();p(f"### {f['id']} — {f['classification'] or 'pending_final'} ({f['calibration']['cal']})")
        p();p(f"Application: `{f['application']}`. Pattern: `{f['calibration']['pattern']}`.")
        p();p('Condition: '+f['source_condition'])
        p();p('Calibration note (verbatim): '+f['calibration']['note'])
        p();p('Retained-question scope: '+f['coverage_aspect'])
        p();p('Source evidence:')
        for e in f['source_evidence']:
            p(f"`{e['file']}:{e['start_line']}` through line {e['end_line']}")
            p('```text');p(e['numbered_text']);p('```')
        p(f"Source bundle SHA-256: `{f['source_bundle_sha256']}`.")
        for title,key in [('BEFORE exact relevant matches','baseline_matches'),('AFTER exact relevant matches','final_matches')]:
            p();p('**'+title+'**')
            if not f[key]:p('None.' if key=='baseline_matches' or f['final_status']=='available' else 'Pending qualified lane file.')
            for m in f[key]:
                p(f"- `{m['code']}` at `{fmt_site(m['site'])}` ({m['kind']}; `{m['collection']}[{m['index']}]`): {m['message']}")
                if m.get('attached_candidate_question'):p('  Attached candidate question: `'+m['attached_candidate_question']+'`. No replay verdict counted.')
        p();p('**Broad/nearby questions excluded from coverage**')
        if not any(f['broad_or_nearby_not_counted'].values()):p('None needed to explain this verdict; unrelated lane diagnostics are excluded (full inventories in JSON).')
        for phase in ('baseline','final'):
            for m in f['broad_or_nearby_not_counted'][phase]:
                p(f"- {phase}: `{m['code']}` at `{fmt_site(m['site'])}`: {m['message']}")
        p();p('Rationale: '+f['rationale'])
        p();p('Verdict: '+f['outcome'])
    p();p('## Source/result custody hashes')
    for lane in r['lanes']:
        p();p(f"- w{lane['wave']}-{lane['lane']}: source bundle `{lane['source_bundle_sha256']}`.")
        for sf in lane['source_files']:p(f"  Source `{sf['path']}` — `{sf['sha256']}`.")
        x=lane['final_result_file']
        if x and 'sha256' in x:p(f"  Qualified result `{x['path']}` — `{x['sha256']}`.")
        elif x:p('  Qualified result uses the aggregate hash listed above.')
        else:p('  Qualified result pending.')
    if scope['pending_final_files']:
        p();p('## Remaining work');p();p('Compare these qualified lane files when available:')
        for x in scope['pending_final_files']:p('- `'+x+'`')
    p();p('The calibration records contain related findings that share an underlying hole (for example wave26 025F1/F2). Counts above are per commissioned finding, not deduplicated root causes. `uncovered_before` is a baseline absence, not a regression. Broad questions are never promoted to exact matches to improve a count.')
    (OUT/'calibration-retention.md').write_text('\n'.join(ls)+'\n')

if __name__=='__main__':main()
