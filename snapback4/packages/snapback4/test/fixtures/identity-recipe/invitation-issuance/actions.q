use server
-- Optional B1d.3 declaration. During qualification append this declaration to
-- the staged snapback/schema.q; do not copy this file as a namespaced module.
action issueInvitation(organization: organizations, recipientEmail: text 1..320) returns { invitation: invitations, delivery: enum('accepted', 'not-sent'), providerMessageId: text <=100 ? } secrets [MAIL_API_KEY] retry 3 deadline 10m
