-- Trade pedal transaction: add new owned pedal and retire traded-away pedal
CREATE OR REPLACE FUNCTION public.trade_pedal(
  p_new_pedal_id uuid,
  p_colorway_id uuid,
  p_acquired_date date,
  p_acquired_trade_for text,
  p_acquired_trade_with text,
  p_traded_from_user_pedal_id uuid,
  p_trade_cash_paid numeric,
  p_notes text,
  p_category_override text,
  p_retired_note text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_old_pedal_id uuid;
  v_new_user_pedal_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Validate traded-away pedal
  SELECT pedal_id
    INTO v_old_pedal_id
  FROM public.user_pedals
  WHERE id = p_traded_from_user_pedal_id
    AND user_id = v_user_id
    AND status = 'owned';

  IF v_old_pedal_id IS NULL THEN
    RAISE EXCEPTION 'Trade source pedal not found or not owned';
  END IF;

  -- Insert new owned pedal
  INSERT INTO public.user_pedals (
    user_id,
    pedal_id,
    colorway_id,
    status,
    acquired_method,
    acquired_date,
    acquired_trade_for,
    acquired_trade_with,
    traded_from_user_pedal_id,
    trade_cash_paid,
    notes,
    category_override
  ) VALUES (
    v_user_id,
    p_new_pedal_id,
    p_colorway_id,
    'owned',
    'trade',
    p_acquired_date,
    p_acquired_trade_for,
    p_acquired_trade_with,
    p_traded_from_user_pedal_id,
    p_trade_cash_paid,
    p_notes,
    p_category_override
  )
  RETURNING id INTO v_new_user_pedal_id;

  -- Retire traded-away pedal and append note
  UPDATE public.user_pedals
  SET status = 'retired',
      retired_date = p_acquired_date,
      retired_method = 'trade',
      retired_trade_for = p_acquired_trade_for,
      retired_to = p_acquired_trade_with,
      retired_notes =
        CASE
          WHEN p_retired_note IS NULL OR p_retired_note = '' THEN retired_notes
          WHEN retired_notes IS NULL OR retired_notes = '' THEN p_retired_note
          ELSE retired_notes || E'\n' || p_retired_note
        END
  WHERE id = p_traded_from_user_pedal_id
    AND user_id = v_user_id;

  -- Remove from any boards
  DELETE FROM public.board_slots
  WHERE pedal_id = v_old_pedal_id
    AND board_id IN (
      SELECT id FROM public.boards WHERE user_id = v_user_id
    );

  RETURN v_new_user_pedal_id;
END;
$$;

REVOKE ALL ON FUNCTION public.trade_pedal(
  uuid, uuid, date, text, text, uuid, numeric, text, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trade_pedal(
  uuid, uuid, date, text, text, uuid, numeric, text, text, text
) TO authenticated;
