-- Refund notices only for late events that prove a payment.
--
-- Every Polar subscription event that arrives for a blog the purge is
-- deleting (or has deleted) is still recorded in autoseopilot_purge_conflicts,
-- but only an event that carries successful-payment evidence (an active
-- subscription, a succeeded checkout) owes the "refund needed" notice. An
-- unpaid, incomplete or cancelled event is kept as a record only.
ALTER TABLE autoseopilot_purge_conflicts
  ADD COLUMN payment_evidence INTEGER NOT NULL DEFAULT 0;

-- The rows recorded before this column existed only kept the mapped status.
-- 'active' (a paid subscription or a succeeded checkout) is the evidence they
-- carry; every other status was never a payment.
UPDATE autoseopilot_purge_conflicts
  SET payment_evidence = 1
  WHERE applied_status = 'active';
