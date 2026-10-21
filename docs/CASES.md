# Sterling case admin: operator guide

Sign in at **sterlingpensiongroup.com/admin** with your email address. You get a 6-digit code by email (valid 10 minutes). There is no password. Sessions last 12 hours.

## A case, step by step

1. **An intake arrives.** The partner's email to the intake address creates a case (reference `SPG-YYYY-NNNN`) and Claude fills in the details. You get an email "New case … needs review". Intakes that arrive another way: **New case**, optionally paste the text.
2. **Review and confirm.** Open the case. Amber fields were interpreted, red fields are missing. Check the **client email language** (German is suggested for German, Austrian and Swiss clients). If the client must supply something, use **Request missing details from the client…** (you see the full email before it goes out). Then set the **date of signing** and click **Confirm details and generate documents**. This creates documents 1–4 and **certificate C1** (onboarding, dated on the signing date). The signing date must be before the first payment date.
3. **Send for signature.** One BoldSign envelope with 5 documents. The client signs the Operating Agreement and the Written Consent first; then you sign those two plus the Corporate Pension Policy, the Pension Award Letter and certificate C1.
4. **Signed.** The signed PDFs are stored and the client automatically gets **email A** with all five e-signed documents and the audit trail. Email A explains that C1 cannot confirm payments yet. If the signing date differs from the date printed in the documents, the case shows a warning.
5. **Award Letter notary.** In *Pension Award Letter*: **Download for notary** gives an unsigned copy for you to sign in the meeting. Enter the meeting (tick the box to date the letter on the meeting day), then upload the notarized copy and the apostille (or forward the notary's email to the intake address with the reference in the subject and use **File as…**). Send **email B** (preview first) and add the courier shipment.
6. **Certificates.** Each certificate is a numbered issue (C1, C2, …) with its own panel: download for notary, optional notary meeting and uploads, **Send certificate C{n}** email, and optional courier. The certificate email attaches that certificate plus the latest versions of documents 1–4.
7. **Later certificates (payment history).** When the client asks for an updated certificate and has sent payment evidence: **Issue new certificate**, enter the certificate date, the number of monthly payments made and the date of the most recent payment, and tick "I have verified these payments against the Designated Fund bank records". Your name and the time are recorded. Upload the evidence to the new issue. Sign it with **Send C{n} for e-signature** (BoldSign, only you sign), or have it notarized instead. Then send it.
8. **Close** the case when onboarding is done. Certificates can still be issued on a closed case.

## Rules the system enforces

- C1 (onboarding) must be dated **before** the first payment date; it says no payment has yet fallen due.
- Payment-history certificates must be dated **on or after** the first payment date, report at least one payment, and the payments must fit one per month up to the most recent payment, which cannot be in the future.
- Emails B and certificate emails need the notarized or signed copy first.

## Good to know

- **Test mode:** while the yellow TEST MODE bar shows, every client email and the client's BoldSign request go to the test address instead of the client. The case log shows who it would have gone to.
- **Draft watermark:** until counsel approves the templates, all documents carry "DRAFT – PENDING COUNSEL REVIEW", and in live mode sending to clients is blocked.
- **Email wording** (English and German) is pending owner approval; see Settings. Documents are always English.
- **Hold / Cancel** keep all data. **Delete case data** removes everything permanently (type the reference to confirm).
- **Unassigned inbox:** mail from unknown senders, or with an unknown reference, waits there. Create a case from it, attach it to a case, or dismiss it.
- **Reminders:** a daily check emails you about cases waiting too long (signature over 7 days, review over 2 days, Award Letter notary over 14 days).
- Uploads: PDF, JPEG or PNG, up to 25 MB each.
