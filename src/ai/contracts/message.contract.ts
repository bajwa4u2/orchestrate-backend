export interface MessageDraft {
  subject: string;
  body: string;
  tone: string;
  intent: string;
}

export interface LeadMessageDraft {
  leadEmail?: string;
  leadFullName: string;
  companyName: string;
  draft: MessageDraft;
}
