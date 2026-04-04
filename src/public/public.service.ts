import { Injectable } from '@nestjs/common';

@Injectable()
export class PublicService {
  async getOverview() {
    return {
      leadsActive: 34,
      outreachSent: 126,
      repliesReceived: 18,
      meetingsScheduled: 6,
      invoicesIssuedAmount: 12400,
      paymentsClearedAmount: 8200,
      paymentsDueAmount: 4200,
      status: {
        source: 'foundation',
        note: 'Replace in PublicService with database aggregation once the live orchestrate database service and current module files are wired in this backend.',
      },
    };
  }
}
