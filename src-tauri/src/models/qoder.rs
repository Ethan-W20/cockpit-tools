use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

// IPC 只传展示所需字段；磁盘中的 QoderAccount 仍保留完整认证载荷用于刷新与切号。
const PUBLIC_RAW_SCALARS: &[&str] = &[
    "plan_tier_name", "tier_name", "tierName", "planTierName", "plan_name",
    "planName", "plan",
    "userTag", "user_tag", "security_mobile", "totalUsagePercentage",
    "total_usage_percentage", "creditBreakdownUrl", "usageDetailUrl",
    "usageDetailsUrl", "detailUrl", "overviewUrl", "usageUrl", "upgradeUrl",
    "addCreditsUrl", "add_credits_url", "topUpUrl", "top_up_url", "expiresAt",
    "expires_at", "resetAt", "reset_at", "userType", "user_type",
    "isPersonalVersion", "is_personal_version", "isHighestTier",
    "is_highest_tier", "isQuotaExceeded",
];
const PUBLIC_QUOTA_FIELDS: &[&str] = &[
    "used", "usage", "consumed", "total", "quota", "limit", "remaining",
    "available", "left", "percentage", "usagePercent", "usage_percentage", "unit",
];
const PUBLIC_PACKAGE_FIELDS: &[&str] = &["used", "usage", "consumed", "count"];

fn public_raw_payload(raw: Option<Value>) -> Option<Value> {
    let Value::Object(object) = raw? else { return None; };
    let mut public = Map::new();
    for (key, value) in object {
        if PUBLIC_RAW_SCALARS.contains(&key.as_str()) {
            if value.is_string() || value.is_number() || value.is_boolean() {
                public.insert(key, value);
            }
            continue;
        }
        let fields = match key.as_str() {
            "userQuota" | "addOnQuota" | "addonQuota" | "add_on_quota" => PUBLIC_QUOTA_FIELDS,
            "orgResourcePackage" | "organizationResourcePackage" | "sharedCreditPackage"
            | "resourcePackage" => PUBLIC_PACKAGE_FIELDS,
            _ => continue,
        };
        if let Some(nested) = value.as_object() {
            let safe = nested
                .iter()
                .filter(|(name, value)| {
                    fields.contains(&name.as_str())
                        && (value.is_string() || value.is_number() || value.is_boolean())
                })
                .map(|(name, value)| (name.clone(), value.clone()))
                .collect::<Map<String, Value>>();
            if !safe.is_empty() {
                public.insert(key, Value::Object(safe));
            }
        }
    }
    (!public.is_empty()).then_some(Value::Object(public))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QoderAccount {
    pub id: String,
    // 默认 `qoder` 变体不落该字段（记录保持无 `variant` 键）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variant: Option<String>,
    pub email: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credits_used: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credits_total: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credits_remaining: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credits_usage_percent: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quota_query_last_error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quota_query_last_error_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage_updated_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_user_info_raw: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_user_plan_raw: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_credit_usage_raw: Option<Value>,
    pub created_at: i64,
    pub last_used: i64,
}

impl QoderAccount {
    /// 旧版 App 导入曾把 auth.user 误存为套餐，并将 user.name 写成 plan_type。
    /// 只在能用同一 user.id 证明该字段来自身份资料时隐藏它，不改账号原始文件。
    pub fn plan_type_for_display(&self) -> Option<&str> {
        let plan = self.plan_type.as_deref()?.trim();
        if plan.is_empty() {
            return None;
        }
        let legacy_user = self.auth_user_plan_raw.as_ref();
        let legacy_id = legacy_user.and_then(|raw| raw.get("id")).and_then(Value::as_str);
        let actual_id = self.auth_user_info_raw.as_ref()
            .and_then(|raw| raw.get("user"))
            .and_then(|user| user.get("id"))
            .and_then(Value::as_str)
            .or(self.user_id.as_deref());
        let legacy_name = legacy_user.and_then(|raw| raw.get("name")).and_then(Value::as_str);
        if legacy_id.is_some() && legacy_id == actual_id && legacy_name == Some(plan) {
            None
        } else {
            Some(plan)
        }
    }

    /// 展示层统一读取配额根节点；保留磁盘原文供导出和客户端注入使用。
    /// Sash 响应有 qoderUsage 包装层，本地载荷和 legacy 接口也可能直接返回根节点。
    pub fn credit_usage(&self) -> Option<&Value> {
        let raw = self.auth_credit_usage_raw.as_ref()?;
        Some(raw.get("qoderUsage").unwrap_or(raw))
    }

    pub fn for_ipc(mut self) -> Self {
        self.plan_type = self.plan_type_for_display().map(str::to_string);
        self.auth_user_info_raw = public_raw_payload(self.auth_user_info_raw);
        self.auth_user_plan_raw = public_raw_payload(self.auth_user_plan_raw);
        self.auth_credit_usage_raw = public_raw_payload(self.credit_usage().cloned());
        self
    }

    pub fn without_credentials(mut self) -> Self {
        self.auth_user_info_raw = None;
        self.auth_user_plan_raw = None;
        self.auth_credit_usage_raw = None;
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QoderAccountSummary {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variant: Option<String>,
    pub email: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    pub created_at: i64,
    pub last_used: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QoderAccountIndex {
    pub version: String,
    pub accounts: Vec<QoderAccountSummary>,
}

impl QoderAccountIndex {
    pub fn new() -> Self {
        Self {
            version: "1.0".to_string(),
            accounts: Vec::new(),
        }
    }
}

impl Default for QoderAccountIndex {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QoderOAuthStartResponse {
    pub login_id: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval_seconds: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub callback_url: Option<String>,
}

impl QoderAccount {
    pub fn summary(&self) -> QoderAccountSummary {
        QoderAccountSummary {
            id: self.id.clone(),
            variant: self.variant.clone(),
            email: self.email.clone(),
            user_id: self.user_id.clone(),
            plan_type: self.plan_type_for_display().map(str::to_string),
            tags: self.tags.clone(),
            created_at: self.created_at,
            last_used: self.last_used,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_identity_name_is_not_displayed_as_a_plan() {
        let account: QoderAccount = serde_json::from_value(serde_json::json!({
            "id": "qoder_app_uid_user-a",
            "variant": "qoder_app",
            "email": "user@example.invalid",
            "user_id": "user-a",
            "display_name": "Sample User",
            "plan_type": "Sample User",
            "created_at": 1,
            "last_used": 1,
            "auth_user_info_raw": {"user": {"id": "user-a", "name": "Sample User"}},
            "auth_user_plan_raw": {"id": "user-a", "name": "Sample User"}
        })).expect("legacy account fixture");
        assert_eq!(account.plan_type_for_display(), None);
        assert_eq!(account.clone().for_ipc().plan_type, None);
        assert_eq!(account.summary().plan_type, None);
        assert_eq!(account.plan_type.as_deref(), Some("Sample User"));

        let mut account_with_real_plan = account;
        account_with_real_plan.auth_user_plan_raw = Some(serde_json::json!({"plan": "PRO"}));
        account_with_real_plan.plan_type = Some("PRO".to_string());
        assert_eq!(account_with_real_plan.plan_type_for_display(), Some("PRO"));
    }

}
