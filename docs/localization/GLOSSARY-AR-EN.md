# Glossary: English to Arabic (Modern Standard Arabic) for Keystone CRM

* **Status:** Proposed. Review plan (owner decision): an **internal review first**, before strings are extracted (Phase 3); then a review by one **Egyptian** and one **Saudi** native reader **before Arabic is released to customers**. Changes after extraction go through this file.
* **Source of terms:** the labels that exist in the frontend today (`constants.ts`, navigation, forms, dashboards) and the sale-rule messages of the backend.
* **Related:** [ADR-0001](ADR-0001-localization-architecture.md).

## 1. Rules

1. **Modern Standard Arabic, simplified and neutral.** No dialect words (Egyptian, Gulf or Levantine); a term that is regional is replaced by the neutral one or listed in section 14.
2. **One Arabic term per English term, everywhere.** A CI check rejects a catalog that translates a glossary term two ways.
3. **Gender agreement, solved in the catalog, not in code.** Arabic adjectives and verbs agree with the noun: *deal* (صفقة), *viewing* (معاينة), *task* (مهمة), *commission* (عمولة) are feminine; *lead/client* (عميل), *property* (عقار), *offer* (عرض), *document* (مستند) are masculine. Therefore **the same English label is translated separately per entity** (`enums.dealStage.closed` and `enums.leadStatus.closed` are different keys). Where possible, status labels use **nouns / verbal nouns** (`تم الإغلاق`, `خسارة`, `تفاوض`) because they do not change with gender.
4. **Plurals use ICU**, with all six Arabic categories (see section 13). Never `count === 1 ? ... : ...` in code.
5. **Loanwords stay when they are the everyday term across the region** (`فيلا`, `تاون هاوس`, `بنتهاوس`).
6. **Digits:** Latin by default (a company option later). Currency, dates and relative time come from `Intl`, not from this glossary.
7. **Never translated:** the product and company names (Keystone, the company's own name), file extensions, ISO currency codes, the property reference (`PR-00042`), e-mail addresses, phone numbers, URLs.
8. Address the user in the masculine generic (`أنت`), polite and short; no exclamation marks, no humour.

## 2. Navigation and screens

| English | Arabic | Note |
|---|---|---|
| Dashboard | لوحة المعلومات | |
| Leads / Clients | العملاء | One word for the screen; the lead concept is `عميل محتمل` where it must be distinguished |
| Properties | العقارات | |
| Pipeline | مسار المبيعات | |
| Tasks | المهام | |
| Viewings | المعاينات | |
| Deals | الصفقات | |
| Commissions | العمولات | |
| Documents | المستندات | |
| Reports | التقارير | |
| Notifications | الإشعارات | |
| Profile / Settings | الملف الشخصي والإعدادات | |
| Settings | الإعدادات | |
| Sign in | تسجيل الدخول | |
| Sign out | تسجيل الخروج | |
| Open menu / Close menu | فتح القائمة / إغلاق القائمة | |
| Collapse / Expand (sidebar) | طيّ القائمة / توسيع القائمة | |
| Main (navigation landmark) | التنقل الرئيسي | accessible name |

## 3. Core entities

| English | Arabic | Plural | Note |
|---|---|---|---|
| Lead | عميل محتمل | العملاء المحتملون | |
| Client | عميل | العملاء | |
| Property | عقار | عقارات | |
| Unit | وحدة | وحدات | |
| Deal | صفقة | صفقات | feminine |
| Offer | عرض سعر | عروض الأسعار | short form `عرض` in tight UI |
| Viewing | معاينة | معاينات | feminine |
| Task | مهمة | مهام | feminine |
| Commission | عمولة | عمولات | feminine |
| Document | مستند | مستندات | |
| Note | ملاحظة | ملاحظات | |
| Activity | نشاط | أنشطة | |
| Notification | إشعار | إشعارات | |
| Team | الفريق | | |
| Company | الشركة | | |
| Workspace | مساحة العمل | | |

## 4. Roles

| English | Arabic | Note |
|---|---|---|
| Admin | مسؤول النظام | not `مدير`, to keep it apart from Manager |
| Manager | مدير | sales manager |
| Salesperson | مندوب مبيعات | not `سمسار`; `وسيط عقاري` is used only if "broker/agent" appears in text |
| Assigned to / Owner | المسؤول | the person responsible |
| Role | الدور | |

## 5. Lead

| English (status) | Arabic | Note |
|---|---|---|
| New | جديد | |
| Contacted | تم التواصل | |
| Qualified | مؤهَّل | |
| Viewing | معاينة | noun |
| Offer Made | تقديم عرض | noun |
| Closed | تم الإغلاق | gender-neutral |
| Lost | خسارة | noun |

| English (source) | Arabic |
|---|---|
| Website | الموقع الإلكتروني |
| Referral | توصية من عميل |
| Walk-in | زيارة مباشرة |
| Social media | وسائل التواصل الاجتماعي |
| Listing portal | بوابة الإعلانات العقارية |
| Cold call | اتصال مباشر |
| Event | فعالية |
| Other | أخرى |

## 6. Property

| English (type) | Arabic | | English (status) | Arabic |
|---|---|---|---|---|
| Apartment | شقة | | Available | متاح |
| Villa | فيلا | | Reserved | محجوز |
| Townhouse | تاون هاوس | | Under Offer | عليه عرض |
| Penthouse | بنتهاوس | | Sold | مباع |
| Land | أرض | | Inactive | غير نشط |
| Commercial | تجاري | | | |

| English (field) | Arabic |
|---|---|
| Title | اسم العقار |
| Address | العنوان |
| City / location | المدينة / المنطقة |
| Price | السعر |
| Property type | نوع العقار |
| Bedrooms | غرف النوم |
| Bathrooms | دورات المياه |
| Area (sqm) | المساحة (م²) |
| Status | الحالة |
| Description | الوصف |
| Reference | الرقم المرجعي |
| Images / Cover image | الصور / صورة الغلاف |

## 7. Deal and pipeline (stages are nouns)

| English | Arabic | Note |
|---|---|---|
| Interested | اهتمام | stage of a deal |
| Viewing | معاينة | |
| Offer Made | تقديم عرض | |
| Negotiation | تفاوض | |
| Under Contract | قيد التعاقد | |
| Closed | تم الإغلاق | |
| Lost | خسارة | |
| Stage | المرحلة | |
| Offer amount | مبلغ العرض | |
| Sale price | سعر البيع | |
| Expected close date | تاريخ الإغلاق المتوقع | |
| Closed at | تاريخ الإغلاق | |
| Lost reason | سبب الخسارة | |
| Close deal | إغلاق الصفقة | |
| Mark as lost | تصنيف كخسارة | |

Lead-to-property link (match): Suggested **مقترح**, Interested **مهتم**, Viewing Scheduled **معاينة مجدولة**, Rejected **مرفوض**, Offer Made **تم تقديم عرض**, Purchased **تم الشراء**.

## 8. Offer, viewing, task

| English | Arabic | | English | Arabic |
|---|---|---|---|---|
| Offer: Submitted | مقدَّم | | Viewing: Scheduled | مجدولة |
| Offer: Countered | عرض مضاد | | Viewing: Completed | مكتملة |
| Offer: Accepted | مقبول | | Viewing: Cancelled | ملغاة |
| Offer: Rejected | مرفوض | | Task: Pending | معلّقة |
| Offer: Withdrawn | مسحوب | | Task: Done | مكتملة |
| Record offer | تسجيل عرض | | Task: Overdue | متأخرة |
| Schedule viewing | جدولة معاينة | | Due | الاستحقاق |

| Task type | Arabic |
|---|---|
| Call | مكالمة |
| Email | بريد إلكتروني |
| Viewing | معاينة |
| Follow-up | متابعة |
| Document | مستند |

## 9. Commission

| English | Arabic |
|---|---|
| Pending | بانتظار الاعتماد |
| Approved | معتمدة |
| Paid | مدفوعة |
| Gross commission | إجمالي العمولة |
| Agent commission | عمولة المندوب |
| Net commission | صافي العمولة |
| Commission rate | نسبة العمولة |
| Agent split | حصة المندوب |
| Deductions | الخصومات |
| Approve | اعتماد |
| Mark paid | تأكيد الدفع |

## 10. Documents

| English | Arabic |
|---|---|
| Contract | عقد |
| Offer | عرض سعر |
| Inspection report | تقرير الفحص |
| Identification | إثبات الهوية |
| Agreement | اتفاقية |
| Property disclosure | إفصاح عن العقار |
| Upload | رفع |
| Download | تنزيل |

## 11. Reports and dashboard

| English | Arabic |
|---|---|
| Conversion rate | معدل التحويل |
| Funnel | قمع المبيعات |
| Pipeline value | قيمة المسار |
| Revenue / Sales value | الإيرادات / قيمة المبيعات |
| Active deals | الصفقات النشطة |
| Leads by source | العملاء حسب المصدر |
| Team performance | أداء الفريق |
| Today / Tomorrow / Yesterday | اليوم / غدًا / أمس |
| This month / Last month | هذا الشهر / الشهر الماضي |

## 12. Settings, forms and common actions

| English | Arabic | | English | Arabic |
|---|---|---|---|---|
| Company name | اسم الشركة | | Save | حفظ |
| Workspace label | اسم مساحة العمل | | Cancel | إلغاء |
| Base currency | العملة الأساسية | | Delete | حذف |
| Number & date format | تنسيق الأرقام والتواريخ | | Edit | تعديل |
| Logo | الشعار | | Add / Create | إضافة / إنشاء |
| Language | اللغة | | Search | بحث |
| Password | كلمة المرور | | Filter | تصفية |
| Change password | تغيير كلمة المرور | | Clear | مسح |
| First name / Last name | الاسم الأول / اسم العائلة | | Back / Next / Previous | رجوع / التالي / السابق |
| Phone | الهاتف | | Confirm | تأكيد |
| Email | البريد الإلكتروني | | Yes / No | نعم / لا |
| Source | المصدر | | Loading | جارٍ التحميل |
| Budget | الميزانية | | Retry | إعادة المحاولة |
| Preferred location | المنطقة المفضلة | | Required / Optional | مطلوب / اختياري |
| Next follow-up | موعد المتابعة التالي | | All / None | الكل / بدون |
| Last activity | آخر نشاط | | Mark all as read | تحديد الكل كمقروء |

| Message | Arabic |
|---|---|
| No results | لا توجد نتائج |
| Something went wrong. Please try again. | حدث خطأ ما. يرجى المحاولة مرة أخرى. |
| You do not have permission to do this. | ليست لديك صلاحية لتنفيذ هذا الإجراء. |
| Are you sure? | هل أنت متأكد؟ |
| This cannot be undone. | لا يمكن التراجع عن هذا الإجراء. |
| First name is required | الاسم الأول مطلوب |
| Enter a valid email | أدخل بريدًا إلكترونيًا صحيحًا |

### Sale rules (backend messages that users see; draft translations for the MVP error catalog)

| English | Arabic |
|---|---|
| This property has already been sold in another deal. | تم بيع هذا العقار بالفعل في صفقة أخرى. |
| This property has already been sold in another deal. No new offers can be recorded on it. | تم بيع هذا العقار بالفعل في صفقة أخرى، ولا يمكن تسجيل عروض جديدة عليه. |
| This record is linked to a completed sale and cannot be deleted. | هذا السجل مرتبط بعملية بيع مكتملة ولا يمكن حذفه. |
| A closed deal cannot be moved. | لا يمكن نقل صفقة مغلقة. |
| Closed or lost deals can no longer be edited. | لا يمكن تعديل الصفقات المغلقة أو الخاسرة. |
| This deal already has offers, so its client and property can no longer be changed. Open a new deal instead. | لدى هذه الصفقة عروض بالفعل، لذلك لا يمكن تغيير العميل أو العقار. افتح صفقة جديدة بدلًا من ذلك. |
| A reason is required to mark a deal as lost. | يجب إدخال سبب لتصنيف الصفقة كخسارة. |
| Record an offer amount (or sale price) before closing the deal. | سجّل مبلغ العرض (أو سعر البيع) قبل إغلاق الصفقة. |
| There is already an open deal for this lead and property. | توجد صفقة مفتوحة بالفعل لهذا العميل وهذا العقار. |
| You can only open deals for your own leads. | يمكنك فتح صفقات لعملائك فقط. |

## 13. Plurals (ICU) and gender: patterns to copy

```
deals    {count, plural, zero {لا توجد صفقات} one {صفقة واحدة} two {صفقتان} few {# صفقات} many {# صفقة} other {# صفقة}}
leads    {count, plural, zero {لا يوجد عملاء محتملون} one {عميل محتمل واحد} two {عميلان محتملان} few {# عملاء محتملين} many {# عميلًا محتملًا} other {# عميل محتمل}}
viewings {count, plural, zero {لا توجد معاينات} one {معاينة واحدة} two {معاينتان} few {# معاينات} many {# معاينة} other {# معاينة}}
```

(`PluralRules("ar")`: 0 zero, 1 one, 2 two, 3-10 few, 11-99 many, 100+ other.) Numbers inside messages are formatted by `Intl`, so they follow the company's numbering setting.

## 14. Terms deliberately not used

| Not used | Reason | Use instead |
|---|---|---|
| كمبوند | regional (Egypt) | مجمع سكني |
| سمسار | can sound pejorative in some countries | مندوب مبيعات / وسيط عقاري |
| مدير (for Admin) | clashes with Manager | مسؤول النظام |
| ميري / قطعة (regional land terms) | regional | أرض |
| Dialect verbs and particles (`عايز`, `بدي`, `ابغى`) | not MSA | formal forms |

## 15. Open questions for the reviewers

1. `Under Offer`: `عليه عرض` vs `قيد العرض` (which reads as "an offer is on the table, no contract yet" in both Egypt and KSA?).
2. `Listing portal`: `بوابة الإعلانات العقارية` vs `منصة إعلانات`.
3. `Lead`: `عميل محتمل` (used here) vs `عميل متوقع`.
4. `Pending` for commissions: `بانتظار الاعتماد` (explicit) vs `معلّقة`.
5. `Funnel`: `قمع المبيعات` vs `مسار التحويل`.
