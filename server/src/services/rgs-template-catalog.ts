import type { ParsedSection, ParsedTemplate, Placeholder } from "./template-parser.ts";
import {
  canonicalPlaceholder,
  mergePlaceholders,
  setupPlaceholders,
} from "./template-variables.ts";

export type RgsSectionDefinition = {
  key: string;
  title: string;
  bodyText: string;
  requiredSources?: string[];
};

export type RgsMeetingTemplate = {
  slug: string;
  title: string;
  description: string;
  meetingBody: "Governing Body" | "General Body";
  isAnnual: boolean;
  document: "governing-body.docx" | "general-body.docx";
  sectionKeys: string[];
};

export const RGS_SECTIONS: RgsSectionDefinition[] = [
  {
    key: "rgs-governing-body-introduction",
    title: "Introduction",
    bodyText: `Minutes of the Meeting of the Governing Body of Radha Govind Samiti held on the <day> day of <month> <year> at its Registered Office at H.A.F. (B), Part 1, Sector 10, Dwarka Sub-City, New Delhi – 110075. The quorum was complete, and the members present were as follows:

Members Present
<President> - President
<Secretary> - Secretary
<Treasurer> - Treasurer
<Member 1> - Member
<Member 2> - Member
<Member 3> - Member
<Member 4> - Member

Chairperson
<President>, President, chaired the meeting.

Quorum
The quorum being present, the Chairperson called the meeting to order.

Notice of the Meeting
Notice of the meeting was taken as duly served and read.

Signing of Minutes
The Chairperson was informed that the draft minutes of the previous meeting had been distributed to all members and their comments obtained. The minutes were duly recorded within the statutory period of 30 days. The minutes of the previous meeting were placed before the Chairperson and the Chairperson's signature was duly obtained.

Approval of Proceedings
The proceedings of the last meeting were accepted and approved by the Body.`,
  },
  {
    key: "rgs-general-body-introduction",
    title: "Introduction",
    bodyText: `Minutes of the Meeting of the General Body of Radha Govind Samiti held on the <day> day of <month> <year> at its Registered Office at H.A.F. (B), Part 1, Sector 10, Dwarka Sub-City, New Delhi – 110075. The quorum was complete, and the members present were as follows:

Members Present
<President> - President
<Secretary> - Secretary
<Treasurer> - Treasurer
<Member 1> - Member
<Member 2> - Member
<Member 3> - Member
<Member 4> - Member

Chairperson
<President>, President, chaired the meeting.

Quorum
The quorum being present, the Chairperson called the meeting to order.

Notice of the Meeting
Notice of the meeting was taken as duly served and read.

Signing of Minutes
The Chairperson was informed that the draft minutes of the previous meeting had been distributed to all members and their comments obtained. The minutes were duly recorded within the statutory period of 30 days. The minutes of the previous meeting were placed before the Chairperson and the Chairperson's signature was duly obtained.

Approval of Proceedings
The proceedings of the last meeting were accepted and approved by the Body.`,
  },
  {
    key: "rgs-annual-general-body-introduction",
    title: "Introduction",
    bodyText: `Minutes of the Annual General Meeting of the General Body of Radha Govind Samiti held on the <day> day of <month> <year> at its Registered Office at H.A.F. (B), Part 1, Sector 10, Dwarka Sub-City, New Delhi – 110075. The quorum was complete, and the members present were as follows:

Members Present
<President> - President
<Secretary> - Secretary
<Treasurer> - Treasurer
<Member 1> - Member
<Member 2> - Member
<Member 3> - Member
<Member 4> - Member
<Member 5> - Member
<Member 6> - Member

Chairperson
<President>, President, chaired the meeting.

Quorum
The quorum being present, the Chairperson called the meeting to order.

Notice of the Meeting
Notice of the meeting was taken as duly served and read.

Signing of Minutes
The Chairperson was informed that the draft minutes of the previous meeting had been distributed to all members and their comments obtained. The minutes were duly recorded within the statutory period of 30 days. The minutes of the previous meeting were placed before the Chairperson and the Chairperson's signature was duly obtained.

Approval of Proceedings
The proceedings of the last meeting were accepted and approved by the Body.`,
  },
  {
    key: "rgs-investments-of-idle-funds-general-authorization",
    title: "Investments of Idle Funds – General Authorization",
    bodyText: `The Chairperson, <President>, presented a proposal to renew the general authorization for investments, reinvestments, and disinvestments. After discussion, the Board recommended <Treasurer>, Treasurer, and unanimously passed the following resolution:

**RESOLVED THAT**, subject to Section 11(5) of the Income Tax Act, 1961 and all other applicable provisions and rules, the consent of the members be accorded for making investments of the Society's funds in permitted equity shares, mutual funds, government securities, money market instruments, NCDs, debentures, bonds, commercial papers, fixed deposits, recurring deposits, term deposits, or any other permitted investment considered beneficial for the Society.

**RESOLVED FURTHER THAT**, <Treasurer>, Treasurer, be authorized to make or place such investments; issue instructions relating to them; terminate, switch, renew, withdraw, or otherwise deal with invested funds; and do all acts necessary or incidental thereto for the benefit of the Society.`,
  },
  {
    key: "rgs-accepting-and-giving-donations",
    title: "Accepting and Giving Donations",
    bodyText: `The members considered clauses 3(l) and 3(q) of the Memorandum of Association concerning the acceptance of gifts and donations and the provision of aid and donations to institutions having similar objects.

The members agreed that:
- Donations may be accepted in cash or kind for fulfilment of the Society's objects.
- Donations in cash or kind may be given to organizations having similar objects.

<Secretary>, Secretary, was authorized to issue gift letters requesting funds and to consider requests for funds and arrange release of the approved payments.`,
  },
  {
    key: "rgs-appointment-of-income-tax-representative",
    title: "Appointment of Income Tax Representative",
    bodyText: `<Treasurer>, Treasurer, informed the members of the need to appoint an authorized representative to appear before income-tax authorities or the Appellate Tribunal on behalf of the Society. After discussion, the following resolutions were passed:

**RESOLVED THAT**, pursuant to Section 288 of the Income Tax Act, 1961 and other applicable provisions, M/s R. S. Puri & Co., Chartered Accountants, be appointed as the Society's authorized representative for proceedings under that Act, with the authority, rights, obligations, and duties stated in the approved Power of Attorney.

**RESOLVED FURTHER THAT**, a specific Power of Attorney be executed in their favour whenever required.

**RESOLVED FURTHER THAT**, <Secretary>, Secretary, be authorized to complete all related formalities.`,
  },
  {
    key: "rgs-purchase-of-audio-visual-equipment-computers-etc",
    title: "Purchase of Audio-Visual Equipment, Computers etc.",
    bodyText: `With the Chairperson's permission and at the initiative of <Treasurer>, Treasurer, the Body discussed clause 3(g) of the Society's Memorandum of Association and the procurement of computers and audio-visual equipment in furtherance of the Society's objects.

The Body unanimously authorized <Secretary>, Secretary, to assess requirements, conduct market surveys, enter into appropriate contracts, facilitate purchases, and act in the best interests of the Society.`,
  },
  {
    key: "rgs-functioning-of-the-society",
    title: "Functioning of the Society",
    bodyText: `<President>, Chairperson, emphasized the importance of strict adherence to the Society's established objects by reconciling those objects with expenditure across the various categories. The primary and other objects in the Memorandum of Association were reviewed against the expenses incurred.`,
  },
  {
    key: "rgs-educational-charitable-objectives",
    title: "Emphasis on the Educational & Charitable Objectives of the Society",
    bodyText: `The members reviewed the Society's educational, social, philanthropic, and charitable objects. It was noted that donations or aid to educational institutions further those objects. The members agreed to continue supporting underprivileged persons and organizing medical and general awareness camps, with the Society's core mission remaining the priority.`,
  },
  {
    key: "rgs-opening-of-daan-peti-standing-instructions",
    title: "Opening of Daan Peti – Standing Instructions",
    bodyText: `On the initiative of <Secretary>, Secretary, the following was resolved unanimously:

**RESOLVED THAT**, the Daan Peti kept inside Radha Govind Mandir be opened on the premises in the presence of the Accountant and any one Office Bearer.

**RESOLVED FURTHER THAT**, the money received be deposited in the General Fund of the Society.`,
  },
  {
    key: "rgs-monitoring-of-outstanding-donations",
    title: "Monitoring of Outstanding Donations",
    bodyText: `<Secretary>, Secretary, brought to the notice of the members that money was being realized or collected from collectors whose balances were outstanding at the beginning of the year.`,
  },
  {
    key: "rgs-donations-acknowledgement",
    title: "Donations – Acknowledgement",
    bodyText: `Receipts of donations for the General Fund, Corpus Fund, Corpus Endowment Fund, Prachar Endowment Fund, and other applicable funds were duly acknowledged. Significant donors were also noted.

The Body acknowledged the efforts and sincerity of the workers, patrons, visitors, donors, and collectors towards fulfilment of the objects of the Samiti.`,
    requiredSources: ["RGS donation ledger or free-form donation summary"],
  },
  {
    key: "rgs-camps-and-workshops-sponsored",
    title: "Camps and Workshops Sponsored",
    bodyText: `With the Chairperson's permission, <Secretary>, Secretary, presented a report of camps and workshops sponsored by the Samiti, including those conducted with its sister organization, Jagadguru Kripalu Chikitsalaya, Mangarh.

The Board reviewed the following notable camps and workshops:
<concise list of camps and workshops with workshop name, date, time, and location>`,
    requiredSources: ["RGS camps and workshops report or free-form text"],
  },
  {
    key: "rgs-authorization-to-open-fixed-deposit-account",
    title: "Authorization to Open Fixed Deposit Account with Axis Bank",
    bodyText: `The Chairperson, <President>, presented the proposal to open a Fixed Deposit Account in the name of Radha Govind Samiti with Axis Bank, Sector 5, Dwarka, New Delhi, so that surplus funds could earn a reasonable return. After deliberation, the following resolutions were passed:

**RESOLVED THAT**, consent be accorded to open the Fixed Deposit Account and that the application be signed by <Treasurer>, Treasurer and Authorized Signatory.

**RESOLVED FURTHER THAT**, <Treasurer>, Treasurer, be authorized to instruct the Bank to renew, close on or before maturity, create a lien over, or transfer the proceeds of the deposit to an account held in the name of Radha Govind Samiti.

**RESOLVED FURTHER THAT**, a certified true copy of this resolution authenticated by <President>, President, be forwarded to the Bank and remain effective until the Bank receives notice of a change in authority.`,
  },
  {
    key: "rgs-prachar-prasar-expenses",
    title: "Prachar Prasar Expenses",
    bodyText: `<Secretary>, Secretary, presented a summary of Prachar Prasar expenses incurred during Financial Year <current Financial Year>. The principal areas of expenditure were:

<Bullet list of Prachar and Prasar Expenses>`,
    requiredSources: ["RGS Prachar Prasar expense ledger or free-form summary"],
  },
  {
    key: "rgs-investment-chart",
    title: "Investment Chart",
    bodyText: `The investment chart, duly initialled by the Chairperson for identification, was laid before the Board and perused by the members. Significant points of discussion included:

Investment made in
- Fixed Deposits out of <insert fund names for Fixed Deposits>

Maturity of
- <insert fund names for matured Fixed Deposits> investments in Fixed Deposits

Cancellation, where applicable, of
- <insert names of funds of cancelled investments> investments in Fixed Deposits`,
    requiredSources: ["RGS investment ledger export or free-form investment summary"],
  },
  {
    key: "rgs-review-of-significant-activities",
    title: "Review of Significant Activities",
    bodyText: `The Board was briefed on the day-to-day activities of the Samiti. The key areas of discussion were as follows:

**A. Donations / Daan Peti Openings**
The Daan Peti was opened on the following dates:
<Daan Peti Opening Dates>

**B. Other Significant Activities**
<insert other significant activities with relevant bullets per activity>

The Board took note of all the above activities and discussions.`,
    requiredSources: ["RGS activity report, Daan Peti dates, or free-form text"],
  },
  {
    key: "rgs-authorization-for-janmashtami-celebrations",
    title: "Authorization for Shri Krishna Janmashtami Celebrations",
    bodyText: `The Board considered the permissions and clearances required from the Police, Traffic Police, Fire Department, DDA, SDMC, and other authorities for Shri Krishna Janmashtami celebrations at the Samiti's registered address.

**RESOLVED THAT**, <Member 3 S/O Father of Member 3>, Member, be authorized to conduct all correspondence with the relevant authorities for the celebrations.

**RESOLVED FURTHER THAT**, <Member 3 S/O Father of Member 3> be authorized to sign and execute all related documents and do all acts ancillary or incidental thereto.`,
  },
  {
    key: "rgs-editor-resignations-and-authorization",
    title: "Resignation of Editors of Saadhan Saadhya Magazine and Editorial Authorization",
    bodyText: `<Secretary>, Secretary, informed the Governing Body that <Member 2>, Member, and <Treasurer>, Treasurer, had tendered their resignations from their editorial roles for Saadhan Saadhya Magazine owing to pressing family circumstances involving <Member 1>. The Board accepted the resignations with empathy and recorded its appreciation for their service. The resignation of <Treasurer> was limited to editorial responsibilities and did not affect the office of Treasurer.

**RESOLVED THAT**, the editorial resignations of <Member 2> and <Treasurer> be accepted with regret and appreciation.

**RESOLVED FURTHER THAT**, <President>, President and Chairperson, be authorized to assume the additional responsibility of editing the magazine.

**RESOLVED FURTHER THAT**, <Secretary>, Secretary, be authorized to sign and execute this resolution and all related correspondence and documents on behalf of Radha Govind Samiti.`,
  },
  {
    key: "rgs-approval-of-annual-foreign-accounts",
    title: "Approval of Annual (Foreign) Accounts for FCRA, 2010 Requirements",
    bodyText: `<Secretary>, Secretary, informed the members that compliance with the Foreign Contribution (Regulation) Act, 2010 required the applicable return to be filed with the Ministry of Home Affairs together with the audited financial statements and details of foreign contributions. The following was resolved unanimously:

**RESOLVED THAT**, the draft Balance Sheet as at 31 March and the Income & Expenditure Account and Receipts & Payments Account for the year ended on that date, prepared for reporting under the Foreign Contribution (Regulation) Act, 2010, be approved, authenticated by the members, sent to the auditors for their report, and thereafter laid before the members for adoption.

**RESOLVED FURTHER THAT**, <Secretary>, Secretary, be authorized to sign the accounts on behalf of the members in authentication thereof.`,
    requiredSources: ["Draft RGS FCRA annual accounts"],
  },
  {
    key: "rgs-approval-of-annual-accounts",
    title: "Approval of Annual Accounts",
    bodyText: `On the Chairperson's proposal for approval of the annual accounts, the following was resolved unanimously:

**RESOLVED THAT**, the draft Balance Sheet as at 31 March and the Income & Expenditure Account and Receipts & Payments Account for the year ended on that date be approved, authenticated by the members, sent to the auditors for their report, and thereafter laid before the members for adoption.

**RESOLVED FURTHER THAT**, <Secretary>, Secretary, be authorized to sign the accounts on behalf of the members in authentication thereof.`,
    requiredSources: ["Draft RGS annual accounts"],
  },
  {
    key: "rgs-donation-given",
    title: "Donation – Given",
    bodyText: `<Secretary>, Secretary, informed the Board that the Samiti, in response to formal requests received, had made the following donations in furtherance of its objects:

<Donation Dates, Recipients, Purposes, and Amounts>

The Board took note of and acknowledged the donations.`,
    requiredSources: ["RGS donation payment ledger or free-form donation details"],
  },
  {
    key: "rgs-holding-meeting-for-adoption-of-annual-accounts",
    title: "Holding of Meeting for Adoption of Annual Accounts",
    bodyText: `With the Chairperson's permission, <Secretary>, Secretary, informed the Board of the need to convene a General Body Meeting to adopt the audited annual accounts after receipt of the auditors' report. With the members' consent, the Annual General Body Meeting was scheduled for <Date of Annual General Body Meeting> at the Samiti's registered office in Delhi.`,
  },
  {
    key: "rgs-adoption-of-annual-foreign-accounts",
    title: "Adoption of Annual (Foreign) Accounts",
    bodyText: `<Secretary>, Secretary, with the Chairperson's permission, laid before the members the audited annual foreign accounts for the financial year ending on <Date of Adoption of Annual (Foreign Accounts)> together with the audit report. The following was resolved unanimously:

**RESOLVED THAT**, the Balance Sheet and the Income & Expenditure Account and Receipts & Payments Account for the year ended on <Date of Adoption of Annual (Foreign Accounts)>, prepared under the Foreign Contribution (Regulation) Act, 2010 and accompanied by the auditors' certificate, be adopted.

**RESOLVED FURTHER THAT**, <Secretary>, Secretary, be authorized to file the applicable return and adopted financial statements with the Ministry of Home Affairs and do all acts necessary or incidental thereto.`,
    requiredSources: ["Audited RGS FCRA annual accounts and audit report"],
  },
  {
    key: "rgs-adoption-of-annual-accounts",
    title: "Adoption of Annual Accounts",
    bodyText: `<Secretary>, Secretary, with the Chairperson's permission, laid before the members the audited annual accounts for the financial year ending on <Date of Adoption of Annual (Foreign Accounts)> together with the audit report. The following was resolved unanimously:

**RESOLVED THAT**, the Balance Sheet and the Income & Expenditure Account and Receipts & Payments Account for the year ended on <Date of Adoption of Annual (Foreign Accounts)>, together with the auditors' report thereon, be adopted.`,
    requiredSources: ["Audited RGS annual accounts and audit report"],
  },
  {
    key: "rgs-appointment-of-auditors",
    title: "Appointment of Auditors",
    bodyText: `On the proposal of <Secretary>, Secretary, the following was resolved unanimously:

**RESOLVED THAT**, M/s R. S. Puri & Co., Chartered Accountants, be appointed auditors of the Society for Financial Year <Financial Year> at remuneration to be determined by the members in consultation with the auditors.

The Chairperson instructed <Secretary>, Secretary, to correspond with the auditors and obtain their consent.`,
  },
  {
    key: "rgs-reconstitution-of-banking-authority",
    title: "Removal of Authorised Signatory and Reconstitution of Banking Authority",
    bodyText: `The Chairperson informed the Board that an existing authorized signatory had ceased to be a member of Radha Govind Samiti and that the banking authority for the Samiti's Audio Video Unit account with Axis Bank, Dwarka Sector 5, New Delhi, should be reconstituted.

**RESOLVED THAT**, the outgoing signatory be removed from the relevant account.

**RESOLVED FURTHER THAT**, the following persons be authorized to open, operate, and close the account jointly, any two out of three:
- <President> - President
- <Member 1> - Member
- <Treasurer> - Treasurer

**RESOLVED FURTHER THAT**, the Bank be authorized to act on instructions given in the prescribed joint mode and that the Society accept the Bank's applicable terms and conditions.`,
  },
  {
    key: "rgs-sale-of-immovable-property",
    title: "Proposed Sale of Immovable Property – Authorisation of Office Bearer",
    bodyText: `<President>, Chairperson, informed the members of the Samiti's financial and operational requirements and the proposal to monetize an immovable asset in furtherance of its charitable, social, philanthropic, and educational objects.

<Property proposed for sale and reasons>

**RESOLVED THAT**, the consent of the members be accorded for the proposed sale of the identified immovable property.

**RESOLVED FURTHER THAT**, <Authorized Office Bearer>, Office Bearer, be authorized to conduct all correspondence, sign and execute agreements, undertakings, applications, returns, receipts, and all other documents relating to the sale and registration, and do all acts ancillary or incidental thereto.`,
    requiredSources: ["Property details and proposed-sale authorization instructions"],
  },
  {
    key: "rgs-vote-of-thanks",
    title: "Vote of Thanks",
    bodyText:
      "In the absence of any other matter to discuss, the meeting concluded with a vote of thanks to the Chair.",
  },
];

export const RGS_MEETING_TEMPLATES: RgsMeetingTemplate[] = [
  {
    slug: "first-meeting",
    title: "First Meeting",
    description:
      "First Governing Body meeting of the financial year, including standing authorizations and recurring reviews.",
    meetingBody: "Governing Body",
    isAnnual: false,
    document: "governing-body.docx",
    sectionKeys: [
      "rgs-governing-body-introduction",
      "rgs-investments-of-idle-funds-general-authorization",
      "rgs-accepting-and-giving-donations",
      "rgs-appointment-of-income-tax-representative",
      "rgs-purchase-of-audio-visual-equipment-computers-etc",
      "rgs-functioning-of-the-society",
      "rgs-educational-charitable-objectives",
      "rgs-opening-of-daan-peti-standing-instructions",
      "rgs-monitoring-of-outstanding-donations",
      "rgs-donations-acknowledgement",
      "rgs-camps-and-workshops-sponsored",
      "rgs-authorization-to-open-fixed-deposit-account",
      "rgs-prachar-prasar-expenses",
      "rgs-review-of-significant-activities",
      "rgs-vote-of-thanks",
    ],
  },
  {
    slug: "flexible-meeting",
    title: "Flexible Meeting",
    description:
      "Recurring Governing Body meeting with the common investment, activity, and workshop sections.",
    meetingBody: "Governing Body",
    isAnnual: false,
    document: "governing-body.docx",
    sectionKeys: [
      "rgs-governing-body-introduction",
      "rgs-investment-chart",
      "rgs-camps-and-workshops-sponsored",
      "rgs-review-of-significant-activities",
      "rgs-vote-of-thanks",
    ],
  },
  {
    slug: "general-body-flexible-meeting",
    title: "Flexible Meeting",
    description:
      "Flexible General Body meeting with the common investment, activity, and workshop sections.",
    meetingBody: "General Body",
    isAnnual: false,
    document: "general-body.docx",
    sectionKeys: [
      "rgs-general-body-introduction",
      "rgs-investment-chart",
      "rgs-camps-and-workshops-sponsored",
      "rgs-review-of-significant-activities",
      "rgs-vote-of-thanks",
    ],
  },
  {
    slug: "approval-of-accounts",
    title: "Approval of Accounts",
    description:
      "General Body meeting to approve draft annual and FCRA accounts before audit and adoption.",
    meetingBody: "General Body",
    isAnnual: false,
    document: "general-body.docx",
    sectionKeys: [
      "rgs-general-body-introduction",
      "rgs-approval-of-annual-foreign-accounts",
      "rgs-approval-of-annual-accounts",
      "rgs-donations-acknowledgement",
      "rgs-donation-given",
      "rgs-holding-meeting-for-adoption-of-annual-accounts",
      "rgs-review-of-significant-activities",
      "rgs-vote-of-thanks",
    ],
  },
  {
    slug: "adoption-of-accounts",
    title: "Adoption of Accounts",
    description:
      "Annual General Body meeting to adopt audited accounts and complete related annual business.",
    meetingBody: "General Body",
    isAnnual: true,
    document: "general-body.docx",
    sectionKeys: [
      "rgs-annual-general-body-introduction",
      "rgs-adoption-of-annual-foreign-accounts",
      "rgs-adoption-of-annual-accounts",
      "rgs-appointment-of-auditors",
      "rgs-reconstitution-of-banking-authority",
      "rgs-sale-of-immovable-property",
      "rgs-camps-and-workshops-sponsored",
      "rgs-investment-chart",
      "rgs-review-of-significant-activities",
      "rgs-vote-of-thanks",
    ],
  },
];

function extractPlaceholders(text: string): Placeholder[] {
  const placeholders: Placeholder[] = [];
  for (const match of text.matchAll(/<([^<>\n]{2,200}?)>/g)) {
    const placeholder = canonicalPlaceholder(match[1] ?? "");
    if (placeholder) placeholders.push(placeholder);
  }
  return mergePlaceholders(placeholders);
}

export function buildRgsParsedTemplate(template: RgsMeetingTemplate): ParsedTemplate {
  const byKey = new Map(RGS_SECTIONS.map((section) => [section.key, section]));
  const sections: ParsedSection[] = template.sectionKeys.map((key, index) => {
    const section = byKey.get(key);
    if (!section) throw new Error(`RGS section missing: ${key}`);
    return {
      key: section.key,
      ordinal: index + 1,
      title: section.title,
      bodyText: section.bodyText,
      bodyXml: "",
      placeholders: extractPlaceholders(`${section.title}\n${section.bodyText}`),
    };
  });
  return {
    title: template.title,
    preambleText: "",
    preambleXml: "",
    globalPlaceholders: setupPlaceholders(
      [],
      sections.flatMap((section) => section.placeholders),
      "rgs",
    ),
    sections,
  };
}
