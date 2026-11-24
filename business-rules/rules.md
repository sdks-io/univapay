# Univapay Public API: business rules

518 rules (207 loud, 311 silent), each taken from the API definition or the docs. A loud rule makes the API refuse the request; a silent one gives a result with no error. Each line: when it applies → what the API does, then what the app must do, the source and the rule's id.

- Rules for every request: `every-request.md` (32 rules).
- Rules for jobs the API runs on its own (renewals, retries, webhooks it sends): `background.md` (89 rules).
- Rules by operation: the file below, one section per operation, headed with its route. A rule on several operations is listed under each.

| Operation | File | Rules |
|---|---|---|
| `GET /me` (`getCurrentMerchant`) | `operations/merchants.md` | 5 |
| `GET /checkout_info` (`getCheckoutInfo`) | `operations/checkout.md` | 5 |
| `GET /stores` (`listStores`) | `operations/stores.md` | 4 |
| `GET /stores/{id}` (`getStore`) | `operations/stores.md` | 4 |
| `POST /stores/{storeId}/create_customer_id` (`createCustomerId`) | `operations/stores.md` | 3 |
| `POST /charges` (`createCharge`) | `operations/charges.md` | 100 |
| `GET /charges` (`listAllCharges`) | `operations/charges.md` | 5 |
| `GET /stores/{storeId}/charges` (`listStoreCharges`) | `operations/charges.md` | 5 |
| `GET /stores/{storeId}/charges/{id}` (`getCharge`) | `operations/charges.md` | 11 |
| `PATCH /stores/{storeId}/charges/{id}` (`updateCharge`) | `operations/charges.md` | 2 |
| `POST /stores/{storeId}/charges/{id}/capture` (`captureCharge`) | `operations/charges.md` | 16 |
| `GET /stores/{storeId}/charges/{id}/issuer_token` (`getChargeIssuerToken`) | `operations/charges.md` | 10 |
| `GET /stores/{storeId}/charges/{id}/three_ds/issuer_token` (`getChargeThreeDsIssuerToken`) | `operations/charges.md` | 3 |
| `GET /stores/{storeId}/charges/{id}/bank_transfer_ledgers` (`listBankTransferLedgers`) | `operations/charges.md` | 1 |
| `POST /stores/{storeId}/charges/{chargeId}/customs` (`createCustomsDeclaration`) | `operations/charges.md` | 4 |
| `GET /stores/{storeId}/charges/{chargeId}/customs/{id}` (`getCustomsDeclaration`) | `operations/charges.md` | 1 |
| `PATCH /stores/{storeId}/charges/{chargeId}/customs/{id}` (`patchCustomsDeclaration`) | `operations/charges.md` | 2 |
| `POST /tokens` (`createTransactionToken`) | `operations/transaction-tokens.md` | 48 |
| `GET /tokens` (`listAllTransactionTokens`) | `operations/transaction-tokens.md` | 5 |
| `GET /stores/{storeId}/tokens` (`listStoreTransactionTokens`) | `operations/transaction-tokens.md` | 5 |
| `GET /stores/{storeId}/tokens/{id}` (`getTransactionToken`) | `operations/transaction-tokens.md` | 4 |
| `PATCH /stores/{storeId}/tokens/{id}` (`updateTransactionToken`) | `operations/transaction-tokens.md` | 6 |
| `DELETE /stores/{storeId}/tokens/{id}` (`deleteTransactionToken`) | `operations/transaction-tokens.md` | 2 |
| `POST /stores/{storeId}/tokens/{id}/three_ds` (`enableTokenThreeDs`) | `operations/transaction-tokens.md` | 5 |
| `DELETE /stores/{storeId}/tokens/{id}/three_ds` (`disableTokenThreeDs`) | `operations/transaction-tokens.md` | 2 |
| `GET /stores/{storeId}/tokens/{id}/three_ds/issuer_token` (`getTokenThreeDsIssuerToken`) | `operations/transaction-tokens.md` | 4 |
| `POST /subscriptions` (`createSubscription`) | `operations/subscriptions.md` | 56 |
| `GET /subscriptions` (`listAllSubscriptions`) | `operations/subscriptions.md` | 1 |
| `POST /subscriptions/simulate_plan` (`simulateSubscriptionPlan`) | `operations/subscriptions.md` | 8 |
| `GET /stores/{storeId}/subscriptions` (`listStoreSubscriptions`) | `operations/subscriptions.md` | 3 |
| `POST /stores/{storeId}/subscriptions/simulate_plan` (`simulateStoreSubscriptionPlan`) | `operations/subscriptions.md` | 8 |
| `GET /stores/{storeId}/subscriptions/{id}` (`getSubscription`) | `operations/subscriptions.md` | 4 |
| `PATCH /stores/{storeId}/subscriptions/{id}` (`updateSubscription`) | `operations/subscriptions.md` | 31 |
| `DELETE /stores/{storeId}/subscriptions/{id}` (`cancelSubscription`) | `operations/subscriptions.md` | 4 |
| `GET /stores/{storeId}/subscriptions/{subscriptionId}/payments` (`listSubscriptionPayments`) | `operations/subscriptions.md` | 1 |
| `PATCH /stores/{storeId}/subscriptions/{subscriptionId}/payments/{paymentId}` (`updateSubscriptionPayment`) | `operations/subscriptions.md` | 4 |
| `GET /stores/{storeId}/subscriptions/{subscriptionId}/charges/latest` (`getSubscriptionLatestCharge`) | `operations/subscriptions.md` | 1 |
| `PATCH /stores/{storeId}/subscriptions/{subscriptionId}/suspend` (`suspendSubscription`) | `operations/subscriptions.md` | 6 |
| `PATCH /stores/{storeId}/subscriptions/{subscriptionId}/unsuspend` (`unsuspendSubscription`) | `operations/subscriptions.md` | 9 |
| `PATCH /stores/{storeId}/subscriptions/{subscriptionId}/token` (`updateSubscriptionToken`) | `operations/subscriptions.md` | 9 |
| `GET /stores/{storeId}/charges/{chargeId}/refunds` (`listRefunds`) | `operations/refunds.md` | 1 |
| `POST /stores/{storeId}/charges/{chargeId}/refunds` (`createRefund`) | `operations/refunds.md` | 28 |
| `GET /stores/{storeId}/charges/{chargeId}/refunds/{id}` (`getRefund`) | `operations/refunds.md` | 3 |
| `PATCH /stores/{storeId}/charges/{chargeId}/refunds/{id}` (`updateRefund`) | `operations/refunds.md` | 1 |
| `GET /stores/{storeId}/charges/{chargeId}/cancels` (`listCancels`) | `operations/cancels.md` | 1 |
| `POST /stores/{storeId}/charges/{chargeId}/cancels` (`createCancel`) | `operations/cancels.md` | 17 |
| `GET /stores/{storeId}/charges/{chargeId}/cancels/{id}` (`getCancel`) | `operations/cancels.md` | 4 |
| `PATCH /stores/{storeId}/charges/{chargeId}/cancels/{id}` (`updateCancel`) | `operations/cancels.md` | 1 |
| `GET /stores/{storeId}/webhooks` (`listWebhooks`) | `operations/webhooks.md` | 1 |
| `POST /stores/{storeId}/webhooks` (`createWebhook`) | `operations/webhooks.md` | 11 |
| `GET /stores/{storeId}/webhooks/{id}` (`getWebhook`) | `operations/webhooks.md` | 2 |
| `PATCH /stores/{storeId}/webhooks/{id}` (`updateWebhook`) | `operations/webhooks.md` | 10 |
| `GET /stores/{storeId}/webhooks/{id}/events` (`listWebhookEvents`) | `operations/webhooks.md` | 2 |
| `GET /merchants/{merchantId}/configuration` (`getDirectDebitConfiguration`) | `operations/direct-debit.md` | 1 |
| `GET /merchants/{merchantId}/notification-configuration` (`getDirectDebitNotificationConfiguration`) | `operations/direct-debit.md` | 1 |
| `GET /merchants/{merchantId}/schedules/current` (`getDirectDebitCurrentSchedule`) | `operations/direct-debit.md` | 2 |
| `GET /merchants/{merchantId}/bank-accounts` (`listDirectDebitBankAccounts`) | `operations/direct-debit.md` | 1 |
| `POST /merchants/{merchantId}/bank-accounts` (`createDirectDebitBankAccount`) | `operations/direct-debit.md` | 5 |
| `GET /merchants/{merchantId}/bank-accounts/{bankAccountId}` (`getDirectDebitBankAccount`) | `operations/direct-debit.md` | 1 |
| `PATCH /merchants/{merchantId}/bank-accounts/{bankAccountId}` (`updateDirectDebitBankAccount`) | `operations/direct-debit.md` | 6 |
| `DELETE /merchants/{merchantId}/bank-accounts/{bankAccountId}` (`deactivateDirectDebitBankAccount`) | `operations/direct-debit.md` | 2 |
| `POST /merchants/{merchantId}/bank-accounts/{bankAccountId}/re-enable` (`reenableDirectDebitBankAccount`) | `operations/direct-debit.md` | 2 |
| `POST /merchants/{merchantId}/bank-accounts/{bankAccountId}/bank-transfers` (`createDirectDebitBankTransfer`) | `operations/direct-debit.md` | 5 |
| `GET /merchants/{merchantId}/bank-transfers` (`listDirectDebitBankTransfers`) | `operations/direct-debit.md` | 1 |
| `GET /merchants/{merchantId}/bank-transfers/{bankTransferId}` (`getDirectDebitBankTransfer`) | `operations/direct-debit.md` | 2 |
| `PATCH /merchants/{merchantId}/bank-transfers/{bankTransferId}` (`updateDirectDebitBankTransfer`) | `operations/direct-debit.md` | 3 |
| `DELETE /merchants/{merchantId}/bank-transfers/{bankTransferId}` (`deleteDirectDebitBankTransfer`) | `operations/direct-debit.md` | 2 |
| `GET /transaction_history` (`listTransactionHistory`) | `operations/transaction-history.md` | 15 |
| `GET /stores/{storeId}/transaction_history` (`listStoreTransactionHistory`) | `operations/transaction-history.md` | 14 |
