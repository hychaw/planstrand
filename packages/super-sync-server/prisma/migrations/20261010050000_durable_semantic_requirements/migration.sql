-- Retained recovery history matters even when it predates the latest snapshot.
ALTER TABLE user_sync_state ADD COLUMN required_capabilities TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
UPDATE user_sync_state AS state
SET required_capabilities = requirements.capabilities
FROM (
  SELECT user_id, array_agg(DISTINCT capability ORDER BY capability) AS capabilities
  FROM operations CROSS JOIN LATERAL unnest(required_capabilities) AS capability
  GROUP BY user_id
) AS requirements
WHERE state.user_id = requirements.user_id;
