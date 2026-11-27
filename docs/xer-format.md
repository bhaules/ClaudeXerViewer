# XER format facts

Reference for `src/xer/*`. Read when a task touches parsing, the model, dates,
durations, calendars, relationships, resources, codes or UDFs.

## File structure
- Tab-delimited, CRLF. `ERMHDR` first line; `%T` table, `%F` fields, `%R` row, `%E` end.
- Encoding is Windows-1252, NOT UTF-8 (en-dash 0x96, apostrophe 0x92, £, €).
- Dates are `yyyy-mm-dd hh:mm`; empty string = no value. Unknown tables/fields:
  ignore, never crash. Real files have 13k+ activities and 40k+ relationships.

## Projects, WBS, activities
- One file can hold several projects; root WBS of each has `proj_node_flag='Y'`
  and a `parent_wbs_id` pointing at an EPS node that is NOT in the file.
- WBS: `PROJWBS.parent_wbs_id`, siblings by `seq_num`. Activities via `TASK.wbs_id`.
- Show `task_code` as Activity ID, never `task_id`.
- `task_type`: TT_Task, TT_Mile (start milestone), TT_FinMile, TT_LOE, TT_WBS, TT_Rsrc.
- `status_code`: TK_NotStart, TK_Active, TK_Complete.

## Durations and dates
- Durations, float, lag are HOURS (`*_hr_cnt`). Convert with the activity's
  `CALENDAR.day_hr_cnt` (fallback 8); weeks/months use `week_hr_cnt`/`month_hr_cnt`.
- Lag calendar: `SCHEDOPTIONS.sched_calendar_on_relationship_lag`
  (rcal_Predecessor default, rcal_Successor, rcal_24Hour, rcal_ProjDefault).
- Current dates (what P6 shows as Start/Finish):
  Start = `act_start_date` ?? `restart_date` ?? `early_start_date` ?? `target_start_date`
  Finish = `act_end_date` ?? `reend_date` ?? `early_end_date` ?? `target_end_date`
  `target_*` are Planned dates, not current.
- Data date: `PROJECT.last_recalc_date`.
- Critical: `PROJECT.critical_path_type` CT_DrivPath -> `TASK.driving_path_flag='Y'`;
  CT_TotFloat -> total float <= `critical_drtn_hr_cnt`. Completed is never critical.

## Calendars
- `CALENDAR.clndr_data` is a nested `(0||Name(attrs)(children))` blob, parsed in
  `src/xer/calendar.ts`. Lines inside it are separated by 0x7F (DEL), not newlines.
  DaysOfWeek days are 1 = Sunday ... 7 = Saturday; ranges `s|06:00|f|10:00`
  (`f|00:00` = midnight); Exceptions use `d|<days since 1899-12-30>`, with no
  children = non-work day.

## Relationships
- `pred_type` PR_FS/PR_SS/PR_FF/PR_SF -> FS/SS/FF/SF.
- Driving relationships: `TASKPRED.aref` is the date the relationship imposes on the
  successor (predecessor date + lag). It drives when no working time on the
  successor's calendar lies between `aref` and the successor's remaining early start
  (FS/SS: `restart_date` ?? `early_start_date`) or finish (FF/SF: `reend_date` ??
  `early_end_date`). Exact equality is wrong: a Fri 17:00 finish drives a Mon 07:00
  start. Completed successors are never driving. Without `aref`, only zero-lag
  relationships can be judged (using the predecessor's date). On real files ~97% of
  open activities with predecessors get a driver; the rest are held by the data
  date or constraints, which is expected.

## Resources and units
- Resources: `RSRC` (`rsrc_short_name` = Resource ID, `rsrc_type` RT_Labor /
  RT_Equip / RT_Mat) and `TASKRSRC` assignments (`target_qty` budget,
  `act_reg_qty + act_ot_qty` actual, `remain_qty` remaining; actual dates
  `act_start_date`/`act_end_date`, remaining dates `restart_date`/`reend_date`).
  Rows with an empty `rsrc_id` are role-only and skipped. `src/xer/usage.ts` spreads
  actual units from actual start to actual finish (or the data date) and remaining
  units over the remaining dates, by working minutes on the activity's calendar
  (linear; resource curves are ignored), stored as per-day running totals.
- Labor units: `TASK.target_work_qty` / `act_work_qty` / `remain_work_qty`
  (budgeted / actual / remaining, in hours). Nonlabor: `*_equip_qty`. WBS rows show sums.

## Activity codes
- `ACTVTYPE` (code types; `actv_code_type` is the name,
  `actv_code_type_scope` AS_Global / AS_EPS / AS_Project), `ACTVCODE` (`short_name` =
  value, `actv_code_name` = description; `parent_actv_code_id` makes sub-codes) and
  `TASKACTV` (task_id, type, code). Only used types become columns, two each (value,
  "(Description)"), keyed `code:<label>` / `codedesc:<label>`. The same name can exist
  in several scopes (23517 has a Global and a Project "PG_Phase"): non-project ones
  get "(Global)"/"(EPS)", remaining clashes are numbered. A sub-code shows its own value.

## Other TASK fields used as columns
- `expect_end_date`, `cstr_date`, `cstr_type2`, `cstr_date2`, `duration_type`
  (DT_FixedDUR2 = Fixed Duration and Units, DT_FixedDrtn = Fixed Duration and
  Units/Time, DT_FixedQty = Fixed Units, DT_FixedRate = Fixed Units/Time),
  `complete_pct_type`, `phys_complete_pct`, `rsrc_id` (primary resource, shown by name).

## UDFs
- `UDFTYPE` (`table_name` TASK = activity UDF, `udf_type_label` is the name
  users see, `logical_data_type` FT_TEXT / FT_INT / FT_FLOAT_2_DECIMALS / FT_MONEY /
  FT_START_DATE / FT_END_DATE / FT_STATICTYPE) and `UDFVALUE` (`fk_id` = task_id;
  value in `udf_text`, `udf_number` or `udf_date` by type). Indicators
  (FT_STATICTYPE) store `UDF_G1..G4` in `udf_text`, shown as red / yellow / green /
  blue dots (mapping inferred from real data, not confirmed against P6). UDF column
  keys are `udf:<label>` so a saved layout carries across files.

## Notebook and steps
- Notebook (TASKMEMO + MEMOTYPE topics) and Steps (TASKPROC) are parsed into
  `Activity.notes` / `Activity.steps`; HTML becomes plain text (`htmlToText`), 0x7F = newline.
