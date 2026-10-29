// Regenerates tests/fixtures/sample.xer: a small, made-up schedule that exercises
// the tricky parts of the format. Written as Windows-1252 bytes, like P6 does.
// Run: node scripts/make-fixture.mjs
import { writeFileSync } from "node:fs";

const table = (name, fields, rows) => [
  `%T\t${name}`,
  `%F\t${fields.join("\t")}`,
  ...rows.map((r) => `%R\t${fields.map((f) => r[f] ?? "").join("\t")}`),
];

// P6's clndr_data blob. Real exports separate lines with 0x7F (DEL), so this does too.
// `workdays` uses JS day numbers (0 = Sunday); P6 numbers days 1 = Sunday ... 7 = Saturday.
function calendarData(workdays, ranges, holidays) {
  const nl = "\x7f\x7f";
  const day = (d) =>
    workdays.includes(d)
      ? `(0||${d + 1}()(${nl}${ranges.map(([s, f], i) => `      (0||${i}(s|${s}|f|${f})())`).join(nl)}))`
      : `(0||${d + 1}()())`;
  const days = [0, 1, 2, 3, 4, 5, 6].map((d) => `    ${day(d)}`).join(nl);
  const exc = holidays.map((h, i) => `    (0||${i}(d|${h})())`).join(nl);
  return `(0||CalendarData()(${nl}  (0||DaysOfWeek()(${nl}${days}))${nl}  (0||VIEW(ShowTotal|Y)())${nl}  (0||Exceptions()(${nl}${exc}))))`;
}

// Labor units (hours of work) per task_id: budgeted, actual, remaining.
const LABOR = {
  1002: { target_work_qty: "160", act_work_qty: "80", remain_work_qty: "80" },
  1004: { target_work_qty: "240", act_work_qty: "0", remain_work_qty: "240" },
  1005: { target_work_qty: "100.5", act_work_qty: "0", remain_work_qty: "100.5" },
};

// Less common TASK fields shown as extra columns.
const EXTRA = {
  1002: { duration_type: "DT_FixedDUR2", rsrc_id: "51", expect_end_date: "2025-02-20 16:00" },
  1003: { duration_type: "DT_FixedDrtn", cstr_date: "2025-02-17 08:00", cstr_type2: "CS_MEOB", cstr_date2: "2025-02-21 16:30" },
  1004: { duration_type: "DT_FixedQty", target_equip_qty: "40", act_equip_qty: "0", remain_equip_qty: "40" },
  1005: { duration_type: "DT_FixedRate", target_equip_qty: "12", act_equip_qty: "1.5", remain_equip_qty: "10.5" },
};

const lines = [
  "ERMHDR\t21.12\t2025-02-03\tProject\tDEMO\tDemo User\tdbxDatabaseNoName\tProject Management\tAUST",
  ...table("UNKNOWNTABLE", ["foo"], [{ foo: "ignored" }]),
  ...table(
    "PROJECT",
    ["proj_id", "proj_short_name", "clndr_id", "last_recalc_date", "critical_path_type", "critical_drtn_hr_cnt", "name_sep_char"],
    [{ proj_id: "100", proj_short_name: "DEMO-001", clndr_id: "10", last_recalc_date: "2025-02-03 08:00", critical_path_type: "CT_TotFloat", critical_drtn_hr_cnt: "0", name_sep_char: "." }],
  ),
  ...table(
    "CALENDAR",
    ["clndr_id", "default_flag", "clndr_name", "day_hr_cnt", "week_hr_cnt", "month_hr_cnt", "clndr_data"],
    [
      // Mon-Fri 08:00-12:00 + 12:30-16:30, with 2025-02-10 (serial 45698) as a holiday.
      { clndr_id: "10", default_flag: "Y", clndr_name: "8h 5d", day_hr_cnt: "8", week_hr_cnt: "40", month_hr_cnt: "172", clndr_data: calendarData([1, 2, 3, 4, 5], [["08:00", "12:00"], ["12:30", "16:30"]], [45698]) },
      // Mon-Sat 07:00-17:00.
      { clndr_id: "11", default_flag: "N", clndr_name: "10h 6d", day_hr_cnt: "10", week_hr_cnt: "60", month_hr_cnt: "260", clndr_data: calendarData([1, 2, 3, 4, 5, 6], [["07:00", "17:00"]], []) },
    ],
  ),
  ...table("SCHEDOPTIONS", ["proj_id", "sched_calendar_on_relationship_lag"], [{ proj_id: "100", sched_calendar_on_relationship_lag: "rcal_Predecessor" }]),
  ...table(
    "PROJWBS",
    ["wbs_id", "proj_id", "seq_num", "proj_node_flag", "wbs_short_name", "wbs_name", "parent_wbs_id"],
    [
      { wbs_id: "1", proj_id: "100", seq_num: "1", proj_node_flag: "Y", wbs_short_name: "DEMO-001", wbs_name: "Demo Project", parent_wbs_id: "999" },
      { wbs_id: "3", proj_id: "100", seq_num: "2", proj_node_flag: "N", wbs_short_name: "CON", wbs_name: "Construction", parent_wbs_id: "1" },
      { wbs_id: "2", proj_id: "100", seq_num: "1", proj_node_flag: "N", wbs_short_name: "ENG", wbs_name: "Engineering", parent_wbs_id: "1" },
      { wbs_id: "4", proj_id: "100", seq_num: "3", proj_node_flag: "N", wbs_short_name: "EMPTY", wbs_name: "Empty WBS", parent_wbs_id: "1" },
      { wbs_id: "5", proj_id: "100", seq_num: "1", proj_node_flag: "N", wbs_short_name: "CIV", wbs_name: "Civil", parent_wbs_id: "3" },
    ],
  ),
  ...table(
    "TASK",
    ["task_id", "proj_id", "wbs_id", "clndr_id", "complete_pct_type", "phys_complete_pct", "task_type", "status_code", "task_code", "task_name", "total_float_hr_cnt", "free_float_hr_cnt", "remain_drtn_hr_cnt", "target_drtn_hr_cnt", "cstr_type", "act_start_date", "act_end_date", "late_start_date", "restart_date", "reend_date", "early_start_date", "early_end_date", "target_start_date", "target_end_date", "driving_path_flag", "target_work_qty", "act_work_qty", "remain_work_qty", "duration_type", "rsrc_id", "expect_end_date", "cstr_date", "cstr_type2", "cstr_date2", "target_equip_qty", "act_equip_qty", "remain_equip_qty"],
    [
      { task_id: "1001", proj_id: "100", wbs_id: "1", clndr_id: "10", complete_pct_type: "CP_Drtn", task_type: "TT_Mile", status_code: "TK_Complete", task_code: "A1000", task_name: "Project Start", remain_drtn_hr_cnt: "0", target_drtn_hr_cnt: "0", act_start_date: "2025-01-06 08:00", late_start_date: "1899-12-30 00:00", target_start_date: "2025-01-06 08:00" },
      { task_id: "1002", proj_id: "100", wbs_id: "2", clndr_id: "10", complete_pct_type: "CP_Drtn", task_type: "TT_Task", status_code: "TK_Active", task_code: "E1000", task_name: "Design \x96 Civil", total_float_hr_cnt: "40", remain_drtn_hr_cnt: "80", target_drtn_hr_cnt: "160", act_start_date: "2025-01-07 08:00", restart_date: "2025-02-03 08:00", reend_date: "2025-02-14 16:00", early_start_date: "2025-02-03 08:00", early_end_date: "2025-02-14 16:00", target_start_date: "2025-01-06 08:00", target_end_date: "2025-01-31 16:00" },
      { task_id: "1003", proj_id: "100", wbs_id: "2", clndr_id: "10", complete_pct_type: "CP_Phys", phys_complete_pct: "0", task_type: "TT_Task", status_code: "TK_NotStart", task_code: "E1010", task_name: "Design Review", total_float_hr_cnt: "0", remain_drtn_hr_cnt: "40", target_drtn_hr_cnt: "40", cstr_type: "CS_MSOA", early_start_date: "2025-02-17 08:00", early_end_date: "2025-02-21 16:00" },
      { task_id: "1004", proj_id: "100", wbs_id: "5", clndr_id: "11", complete_pct_type: "CP_Drtn", task_type: "TT_Task", status_code: "TK_NotStart", task_code: "C1000", task_name: "Excavation", total_float_hr_cnt: "-10", remain_drtn_hr_cnt: "80", target_drtn_hr_cnt: "80", early_start_date: "2025-03-03 07:00", early_end_date: "2025-03-12 17:00" },
      { task_id: "1005", proj_id: "100", wbs_id: "3", clndr_id: "11", complete_pct_type: "CP_Drtn", task_type: "TT_Task", status_code: "TK_NotStart", task_code: "C1010", task_name: "Contractor\x92s Mobilisation", total_float_hr_cnt: "100", remain_drtn_hr_cnt: "50", target_drtn_hr_cnt: "50", early_start_date: "2025-02-24 07:00", early_end_date: "2025-02-28 17:00" },
      { task_id: "1006", proj_id: "100", wbs_id: "777", clndr_id: "99", complete_pct_type: "CP_Drtn", task_type: "TT_Task", status_code: "TK_NotStart", task_code: "Z9999", task_name: "Orphan activity", remain_drtn_hr_cnt: "8", target_drtn_hr_cnt: "8", early_start_date: "2025-02-03 08:00", early_end_date: "2025-02-03 16:00" },
      { task_id: "1007", proj_id: "100", wbs_id: "1", clndr_id: "10", complete_pct_type: "CP_Drtn", task_type: "TT_FinMile", status_code: "TK_NotStart", task_code: "F1000", task_name: "Project Finish", total_float_hr_cnt: "-10", remain_drtn_hr_cnt: "0", target_drtn_hr_cnt: "0", cstr_type: "CS_MEOB", early_start_date: "2025-03-13 08:00", early_end_date: "2025-03-13 08:00" },
    ].map((r) => ({ ...r, ...LABOR[r.task_id], ...EXTRA[r.task_id] })),
  ),
  // Activity codes. "Phase" exists as both a Global and a Project code type; "Unused"
  // has no assignments; D1 is a sub-code of DES. Ignored: an assignment to a missing
  // activity and one to a missing code.
  ...table(
    "ACTVTYPE",
    ["actv_code_type_id", "actv_short_len", "seq_num", "actv_code_type", "proj_id", "wbs_id", "actv_code_type_scope"],
    [
      { actv_code_type_id: "60", seq_num: "1", actv_code_type: "Discipline", proj_id: "100", actv_code_type_scope: "AS_Project" },
      { actv_code_type_id: "61", seq_num: "2", actv_code_type: "Phase", actv_code_type_scope: "AS_Global" },
      { actv_code_type_id: "62", seq_num: "3", actv_code_type: "Phase", proj_id: "100", actv_code_type_scope: "AS_Project" },
      { actv_code_type_id: "63", seq_num: "0", actv_code_type: "Unused", proj_id: "100", actv_code_type_scope: "AS_Project" },
    ],
  ),
  ...table(
    "ACTVCODE",
    ["actv_code_id", "parent_actv_code_id", "actv_code_type_id", "actv_code_name", "short_name", "seq_num"],
    [
      { actv_code_id: "600", actv_code_type_id: "60", actv_code_name: "Engineering", short_name: "ENG", seq_num: "1" },
      { actv_code_id: "601", actv_code_type_id: "60", actv_code_name: "Civil works", short_name: "CIV", seq_num: "2" },
      { actv_code_id: "610", actv_code_type_id: "61", actv_code_name: "Global phase 1", short_name: "P1", seq_num: "1" },
      { actv_code_id: "620", actv_code_type_id: "62", actv_code_name: "Design phase", short_name: "DES", seq_num: "1" },
      { actv_code_id: "621", parent_actv_code_id: "620", actv_code_type_id: "62", actv_code_name: "Detailed design", short_name: "D1", seq_num: "2" },
      { actv_code_id: "630", actv_code_type_id: "63", actv_code_name: "Never used", short_name: "X", seq_num: "1" },
    ],
  ),
  ...table(
    "TASKACTV",
    ["task_id", "actv_code_type_id", "actv_code_id", "proj_id"],
    [
      { task_id: "1002", actv_code_type_id: "60", actv_code_id: "600" },
      { task_id: "1003", actv_code_type_id: "60", actv_code_id: "600" },
      { task_id: "1004", actv_code_type_id: "60", actv_code_id: "601" },
      { task_id: "1005", actv_code_type_id: "60", actv_code_id: "601" },
      { task_id: "1002", actv_code_type_id: "61", actv_code_id: "610" },
      { task_id: "1002", actv_code_type_id: "62", actv_code_id: "620" },
      { task_id: "1003", actv_code_type_id: "62", actv_code_id: "621" },
      { task_id: "9999", actv_code_type_id: "60", actv_code_id: "600" },
      { task_id: "1004", actv_code_type_id: "62", actv_code_id: "999" },
    ].map((r) => ({ proj_id: "100", ...r })),
  ),
  // Resources: UNUSED has no assignments so must not be listed.
  ...table(
    "RSRC",
    ["rsrc_id", "parent_rsrc_id", "rsrc_name", "rsrc_short_name", "rsrc_type"],
    [
      { rsrc_id: "50", rsrc_name: "Civil Crew", rsrc_short_name: "CIV", rsrc_type: "RT_Labor" },
      { rsrc_id: "51", rsrc_name: "Engineer", rsrc_short_name: "ENG", rsrc_type: "RT_Labor" },
      { rsrc_id: "52", rsrc_name: "Unused", rsrc_short_name: "UNUSED", rsrc_type: "RT_Equip" },
    ],
  ),
  // Assignments. Ignored: a role-only assignment (no rsrc_id) and one on a missing activity.
  ...table(
    "TASKRSRC",
    ["taskrsrc_id", "task_id", "proj_id", "rsrc_id", "remain_qty", "target_qty", "act_reg_qty", "act_ot_qty", "act_start_date", "act_end_date", "restart_date", "reend_date", "target_start_date", "target_end_date"],
    [
      // In progress: 80h actual from 07-Jan to the data date (03-Feb), 80h remaining 03-Feb to 14-Feb.
      { taskrsrc_id: "70", task_id: "1002", rsrc_id: "51", remain_qty: "80", target_qty: "160", act_reg_qty: "75", act_ot_qty: "5", act_start_date: "2025-01-07 08:00", restart_date: "2025-02-03 08:00", reend_date: "2025-02-14 16:30" },
      { taskrsrc_id: "71", task_id: "1004", rsrc_id: "50", remain_qty: "240", target_qty: "240", restart_date: "2025-03-03 07:00", reend_date: "2025-03-12 17:00" },
      // Five 10h days, so 20.1h per day.
      { taskrsrc_id: "72", task_id: "1005", rsrc_id: "50", remain_qty: "100.5", target_qty: "100.5", restart_date: "2025-02-24 07:00", reend_date: "2025-02-28 17:00" },
      { taskrsrc_id: "73", task_id: "1004", rsrc_id: "", remain_qty: "10", target_qty: "10", restart_date: "2025-03-03 07:00", reend_date: "2025-03-12 17:00" },
      { taskrsrc_id: "74", task_id: "9999", rsrc_id: "50", remain_qty: "10", target_qty: "10", restart_date: "2025-03-03 07:00", reend_date: "2025-03-12 17:00" },
    ].map((r) => ({ proj_id: "100", ...r })),
  ),
  // Activity UDFs of each kind, plus ones that must be ignored: a WBS UDF, a UDF with no
  // values, and a value for an activity that doesn't exist.
  ...table(
    "UDFTYPE",
    ["udf_type_id", "table_name", "udf_type_name", "udf_type_label", "logical_data_type"],
    [
      { udf_type_id: "900", table_name: "TASK", udf_type_name: "user_field_900", udf_type_label: "Area", logical_data_type: "FT_TEXT" },
      { udf_type_id: "901", table_name: "TASK", udf_type_name: "user_field_901", udf_type_label: "Men per Day", logical_data_type: "FT_FLOAT_2_DECIMALS" },
      { udf_type_id: "902", table_name: "TASK", udf_type_name: "user_field_902", udf_type_label: "Traffic Light", logical_data_type: "FT_STATICTYPE" },
      { udf_type_id: "903", table_name: "TASK", udf_type_name: "user_field_903", udf_type_label: "Unused", logical_data_type: "FT_TEXT" },
      { udf_type_id: "904", table_name: "PROJWBS", udf_type_name: "user_field_904", udf_type_label: "WBS Note", logical_data_type: "FT_TEXT" },
      { udf_type_id: "905", table_name: "TASK", udf_type_name: "user_field_905", udf_type_label: "Review Date", logical_data_type: "FT_END_DATE" },
    ],
  ),
  ...table(
    "UDFVALUE",
    ["udf_type_id", "fk_id", "proj_id", "udf_date", "udf_number", "udf_text", "udf_code_id"],
    [
      { udf_type_id: "900", fk_id: "1002", udf_text: "North" },
      { udf_type_id: "900", fk_id: "1004", udf_text: "South" },
      { udf_type_id: "900", fk_id: "1005", udf_text: "East" },
      { udf_type_id: "901", fk_id: "1002", udf_number: "2.5" },
      { udf_type_id: "902", fk_id: "1004", udf_text: "UDF_G1" },
      { udf_type_id: "904", fk_id: "2", udf_text: "WBS only" },
      { udf_type_id: "905", fk_id: "1003", udf_date: "2025-02-20 00:00" },
      { udf_type_id: "900", fk_id: "9999", udf_text: "No such activity" },
    ].map((r) => ({ proj_id: "100", ...r })),
  ),
  ...table(
    "TASKPRED",
    ["task_pred_id", "task_id", "pred_task_id", "proj_id", "pred_proj_id", "pred_type", "lag_hr_cnt", "aref", "arls"],
    [
      // Not driving: the successor is held by the data date, not by this predecessor.
      { task_pred_id: "1", task_id: "1002", pred_task_id: "1001", pred_type: "PR_FS", lag_hr_cnt: "0", aref: "2025-01-06 08:00" },
      // Driving across a weekend: Fri 16:30 -> Mon 08:00 has no working time between.
      { task_pred_id: "2", task_id: "1003", pred_task_id: "1002", pred_type: "PR_FS", lag_hr_cnt: "0", aref: "2025-02-14 16:30" },
      // Not driving: working days between the imposed date and the successor's start.
      { task_pred_id: "3", task_id: "1004", pred_task_id: "1003", pred_type: "PR_SS", lag_hr_cnt: "16", aref: "2025-02-19 08:00" },
      // Driving finish-to-finish: imposed date equals the successor's early finish.
      { task_pred_id: "4", task_id: "1005", pred_task_id: "1002", pred_type: "PR_FF", lag_hr_cnt: "-8", aref: "2025-02-28 17:00" },
      // No aref (older export), zero lag: falls back to the predecessor's finish. Driving overnight.
      { task_pred_id: "5", task_id: "1007", pred_task_id: "1004", pred_type: "PR_FS", lag_hr_cnt: "0" },
      { task_pred_id: "6", task_id: "1004", pred_task_id: "5555", pred_type: "PR_FS", lag_hr_cnt: "0" },
    ].map((r) => ({ proj_id: "100", pred_proj_id: "100", ...r })),
  ),
  "%E",
];

writeFileSync(new URL("../tests/fixtures/sample.xer", import.meta.url), Buffer.from(lines.join("\r\n") + "\r\n", "latin1"));
console.log("wrote tests/fixtures/sample.xer");
