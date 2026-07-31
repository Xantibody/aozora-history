import type { BalanceSnapshot, TransferRecord } from "../domain/ledger.ts";
import { changeCommentKey, transferCommentKey } from "../domain/comments.ts";
import type { AccountRef } from "../domain/parser.ts";
import type { AutoTransferSetting } from "../domain/auto-transfer.ts";
import type { CollectReport } from "../domain/diagnostics.ts";
import type { Comments } from "../domain/comments.ts";
import { DEFAULT_OBJECT_KEY } from "../infrastructure/r2sync.ts";
import type { LedgerData } from "../domain/merge.ts";
import { STATEMENT_LIMIT } from "../infrastructure/collector.ts";
import type { StatementEntry } from "../domain/statement.ts";
import type { SyncConfig } from "../infrastructure/r2sync.ts";
import { buildStamp } from "../build.ts";
import { statementCommentKey } from "../domain/statement.ts";

/**
 * プレビュー用のダミー台帳。
 *
 * 画面の作りは「振替の記録」「残高の差額」「銀行APIの明細」が噛み合って
 * 初めて意味を持つ(たとえば定額自動振替は記録に残らず、差額から拾い直される)。
 * ばらばらな乱数を並べても画面は埋まるが、確かめたい噛み合わせは見えない。
 * そこで、給与・家賃・積立といった月の流れをそのまま作り、そこから
 * 残高・明細・記録を導く。
 */

export const SCENARIOS = ["rich", "empty", "dense"] as const;

export type Scenario = (typeof SCENARIOS)[number];

export interface DummyData {
  ledger: LedgerData;
  autoTransfers: AutoTransferSetting[];
  syncConfig: SyncConfig | null;
  lastCollect: CollectReport;
  debugMode: boolean;
}

/** 既定は rich。URLの ?data= で切り替える */
export function toScenario(value: string | null): Scenario {
  return SCENARIOS.find((name) => name === value) ?? "rich";
}

const WALLET: AccountRef = { id: "133331", name: "01: お財布" };
const LIVING: AccountRef = { id: "133332", name: "02: 生活費" };
const SAVINGS: AccountRef = { id: "133333", name: "03: 積立" };
const SPECIAL: AccountRef = { id: "133334", name: "04: 特別費" };
const SPARE: AccountRef = { id: "133335", name: "05: 予備費" };

const ACCOUNTS: { ref: AccountRef; opening: number }[] = [
  { ref: WALLET, opening: 318_450 },
  { ref: LIVING, opening: 146_200 },
  { ref: SAVINGS, opening: 782_000 },
  { ref: SPECIAL, opening: 96_800 },
  { ref: SPARE, opening: 210_000 },
];

const PRIMARY_OPENING = 1_240_000;

/** 銀行サイトで登録した定額自動振替。拡張は実行を検知できず、差額から拾い直す */
const AUTO_TRANSFER: AutoTransferSetting = {
  id: "auto-1",
  from: WALLET,
  to: SAVINGS,
  amount: 30_000,
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** 残高を見に行く時刻。実際も一覧ページを開いた夜に記録されることが多い */
const SNAPSHOT_HOUR = 22;
const SNAPSHOT_MINUTE = 30;
/** 最新の記録を「たった今」にはしない。銀行から取り込むまでの間が空くのが普通 */
const LATEST_GAP_MS = 20 * MINUTE_MS;

const SCENARIO_DAYS: Record<Scenario, number> = { rich: 120, empty: 0, dense: 420 };

const PAYDAY = 25;
const ALLOCATION_DAY = 26;
const RENT_DAY = 27;
const UTILITY_DAY = 5;
const CARD_DAY = 10;
const AUTO_TRANSFER_DAY = 1;
const MONDAY = 1;
const THURSDAY = 4;
/** デビット決済を入れる間隔(日) */
const DEBIT_EVERY = 6;

interface World {
  balances: Map<string, number>;
  primaryBalance: number;
  snapshots: BalanceSnapshot[];
  transfers: TransferRecord[];
  statements: StatementEntry[];
  comments: Comments;
  /** 起算日ごとの明細番号。銀行は口座ごと・日ごとに採番する */
  serials: Map<string, number>;
  /** 次のスナップショットで確定する外部入出金に付けるメモ */
  pendingMemos: { accountId: string; text: string }[];
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function valueDateOf(at: Date): string {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** 銀行サイトの「最終更新日時」表記 */
function updatedAtOf(at: Date): string {
  return `${at.getFullYear()}/${pad(at.getMonth() + 1)}/${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

function nextEntryNumber(world: World, scope: string, valueDate: string): string {
  const key = `${scope}:${valueDate}`;
  const next = (world.serials.get(key) ?? 0) + 1;
  world.serials.set(key, next);
  return scope === "" ? pad(next).padStart(4, "0") : String(next);
}

interface Move {
  at: Date;
  /** null なら代表口座(普通預金)。つかいわけ口座の明細だけが口座IDを持つ */
  accountId: string | null;
  amount: number;
  remark: string;
}

/** 口座のお金を動かし、対応する明細を1件残す */
function move(world: World, entry: Move): StatementEntry {
  const { at, accountId, amount, remark } = entry;
  const balance =
    accountId === null
      ? world.primaryBalance + amount
      : (world.balances.get(accountId) ?? 0) + amount;
  if (accountId === null) {
    world.primaryBalance = balance;
  } else {
    world.balances.set(accountId, balance);
  }
  const statement: StatementEntry = {
    entryNumber: nextEntryNumber(world, accountId ?? "", valueDateOf(at)),
    valueDate: valueDateOf(at),
    amount,
    balance,
    remark,
    ...(accountId === null ? {} : { accountId }),
  };
  world.statements.push(statement);
  return statement;
}

interface Transfer {
  at: Date;
  from: AccountRef;
  to: AccountRef;
  amount: number;
  /** 拡張が振替ページで拾えたか。定額自動振替のように記録に残らないものはfalse */
  recorded: boolean;
  memo?: string;
}

function transfer(world: World, plan: Transfer): void {
  const { at, from, to, amount } = plan;
  move(world, { at, accountId: from.id, amount: -amount, remark: `ﾌﾘｶｴ ${to.name}` });
  move(world, { at, accountId: to.id, amount, remark: `ﾌﾘｶｴ ${from.name}` });
  if (!plan.recorded) {
    return;
  }
  const record: TransferRecord = { transferredAt: at.getTime(), from, to, amount };
  world.transfers.push(record);
  if (plan.memo !== undefined) {
    world.comments[transferCommentKey(record)] = { text: plan.memo, updatedAt: at.getTime() };
  }
}

function timeOf(day: Date, hour: number, minute: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
}

interface Event {
  at: Date;
  apply: () => void;
}

/** 給与が入り、つかいわけ口座へ移す日 */
function paydayEvents(world: World, day: Date): Event[] {
  const at = timeOf(day, 9, 0);
  return [
    {
      at,
      apply: (): void => {
        move(world, { at, accountId: null, amount: 425_000, remark: "ｷﾕｳﾖ ｱｵｿﾞﾗｼﾖｳｼﾞ" });
        move(world, { at, accountId: null, amount: -280_000, remark: "ﾂｶｲﾜｹｺｳｻﾞ ﾍ" });
        move(world, { at, accountId: WALLET.id, amount: 280_000, remark: "ﾀｲﾋﾖｳｺｳｻﾞ ﾖﾘ" });
        world.pendingMemos.push({ accountId: WALLET.id, text: "給料" });
      },
    },
  ];
}

/**
 * 給与の翌日にまとめて配分する。コメントは記録の時刻をキーにするため、
 * 続けて操作した2件でも同じ時刻にはしない(同じメモが両方に出てしまう)
 */
function allocationEvents(world: World, day: Date): Event[] {
  const toSavings = timeOf(day, 21, 15);
  const toSpecial = timeOf(day, 21, 18);
  return [
    {
      at: toSavings,
      apply: (): void => {
        transfer(world, {
          at: toSavings,
          from: WALLET,
          to: SAVINGS,
          amount: 50_000,
          recorded: true,
          memo: "つみたて",
        });
      },
    },
    {
      at: toSpecial,
      apply: (): void => {
        transfer(world, {
          at: toSpecial,
          from: WALLET,
          to: SPECIAL,
          amount: 15_000,
          recorded: true,
          memo: "特別費の積み増し",
        });
      },
    },
  ];
}

function monthlyEvents(world: World, day: Date): Event[] {
  const dayOfMonth = day.getDate();
  if (dayOfMonth === AUTO_TRANSFER_DAY) {
    const at = timeOf(day, 3, 0);
    return [
      {
        at,
        // 銀行が夜間に実行する。拡張は振替ページを見ていないので記録に残らない
        apply: (): void => {
          transfer(world, {
            at,
            from: AUTO_TRANSFER.from,
            to: AUTO_TRANSFER.to,
            amount: AUTO_TRANSFER.amount,
            recorded: false,
          });
        },
      },
    ];
  }
  if (dayOfMonth === UTILITY_DAY) {
    const at = timeOf(day, 4, 30);
    return [
      {
        at,
        apply: (): void => {
          move(world, { at, accountId: SPECIAL.id, amount: -12_400, remark: "ﾃﾞﾝｷﾘﾖｳｷﾝ" });
        },
      },
    ];
  }
  if (dayOfMonth === CARD_DAY) {
    const at = timeOf(day, 5, 0);
    return [
      {
        at,
        apply: (): void => {
          const statement = move(world, {
            at,
            accountId: null,
            amount: -87_543,
            remark: "ｸﾚｼﾞﾂﾄｶ-ﾄﾞ",
          });
          world.comments[statementCommentKey(statement)] = {
            text: "カード引落",
            updatedAt: at.getTime(),
          };
        },
      },
    ];
  }
  if (dayOfMonth === PAYDAY) {
    return paydayEvents(world, day);
  }
  if (dayOfMonth === ALLOCATION_DAY) {
    return allocationEvents(world, day);
  }
  if (dayOfMonth === RENT_DAY) {
    const at = timeOf(day, 4, 30);
    return [
      {
        at,
        apply: (): void => {
          move(world, { at, accountId: LIVING.id, amount: -95_000, remark: "ﾔﾁﾝ ｱｵｿﾞﾗﾌﾄﾞｳｻﾝ" });
          world.pendingMemos.push({ accountId: LIVING.id, text: "家賃" });
        },
      },
    ];
  }
  return [];
}

function weeklyEvents(world: World, day: Date): Event[] {
  const dayOfWeek = day.getDay();
  if (dayOfWeek === MONDAY) {
    const at = timeOf(day, 20, 10);
    return [
      {
        at,
        apply: (): void => {
          transfer(world, {
            at,
            from: WALLET,
            to: LIVING,
            amount: 30_000,
            recorded: true,
            memo: "今週の生活費",
          });
        },
      },
    ];
  }
  if (dayOfWeek === THURSDAY) {
    const at = timeOf(day, 12, 40);
    return [
      {
        at,
        apply: (): void => {
          transfer(world, { at, from: WALLET, to: SPARE, amount: 5000, recorded: true });
        },
      },
    ];
  }
  return [];
}

const DEBIT_SHOPS = ["ｽ-ﾊﾟ- ｱｵｿﾞﾗ", "ﾄﾞﾗﾂｸﾞｽﾄｱ", "ｶﾌｴ ﾐﾄﾞﾘ", "ﾎﾞﾝ ﾌﾞ-ﾗﾝｼﾞｴ"];

/**
 * デビット決済。外部出金の摘要を1件に絞れるよう、同じ口座で他の出入りがある日は入れない
 * (同じ日に複数あると差額が合算され、どの明細のことか言い切れなくなる)
 */
function debitEvents(world: World, day: Date, index: number): Event[] {
  const dayOfMonth = day.getDate();
  const busy = dayOfMonth === RENT_DAY || day.getDay() === MONDAY;
  if (busy || index % DEBIT_EVERY !== 0) {
    return [];
  }
  const at = timeOf(day, 18, 45);
  return [
    {
      at,
      apply: (): void => {
        move(world, {
          at,
          accountId: LIVING.id,
          amount: -(2400 + (index % 7) * 640),
          remark: DEBIT_SHOPS[index % DEBIT_SHOPS.length],
        });
      },
    },
  ];
}

function takeSnapshot(world: World, at: Date): void {
  world.snapshots.push({
    takenAt: at.getTime(),
    updatedAt: updatedAtOf(at),
    accounts: ACCOUNTS.map((account) => ({
      id: account.ref.id,
      name: account.ref.name,
      balance: world.balances.get(account.ref.id) ?? 0,
    })),
  });
  for (const memo of world.pendingMemos) {
    // 外部入出金は「区間の終わり」に立つため、キーはこのスナップショットの時刻になる
    const key = changeCommentKey({
      accountId: memo.accountId,
      accountName: "",
      fromTakenAt: 0,
      toTakenAt: at.getTime(),
      delta: 0,
      transferDelta: 0,
      externalDelta: 0,
    });
    world.comments[key] = { text: memo.text, updatedAt: at.getTime() };
  }
  world.pendingMemos = [];
}

/** その日のスナップショット時刻。最終日は now を追い越さないようにする */
function snapshotTimeOf(now: number, daysBack: number): number {
  const base = new Date(now - daysBack * DAY_MS);
  const evening = timeOf(base, SNAPSHOT_HOUR, SNAPSHOT_MINUTE).getTime();
  return Math.min(evening, now - LATEST_GAP_MS);
}

/** 口座ごとに直近ぶんだけ残す。銀行APIも最新100件までしか返さない */
function limitStatements(statements: StatementEntry[]): StatementEntry[] {
  const byScope = new Map<string, StatementEntry[]>();
  for (const statement of statements) {
    const scope = statement.accountId ?? "";
    byScope.set(scope, [...(byScope.get(scope) ?? []), statement]);
  }
  return [...byScope.values()].flatMap((lines) => lines.slice(-STATEMENT_LIMIT));
}

function simulate(days: number, now: number): World {
  const world: World = {
    balances: new Map(ACCOUNTS.map((account) => [account.ref.id, account.opening])),
    primaryBalance: PRIMARY_OPENING,
    snapshots: [],
    transfers: [],
    statements: [],
    comments: {},
    serials: new Map(),
    pendingMemos: [],
  };
  for (let index = 0; index < days; index += 1) {
    const takenAt = snapshotTimeOf(now, days - 1 - index);
    const day = new Date(takenAt);
    const events = [
      ...monthlyEvents(world, day),
      ...weeklyEvents(world, day),
      ...debitEvents(world, day, index),
    ];
    for (const event of events.toSorted((left, right) => left.at.getTime() - right.at.getTime())) {
      // 最終日は途中まで。まだ起きていないことを記録に混ぜない
      if (event.at.getTime() <= takenAt && index > 0) {
        event.apply();
      }
    }
    takeSnapshot(world, new Date(takenAt));
  }
  return world;
}

function collectReport(now: number, statements: number): CollectReport {
  return {
    at: now - LATEST_GAP_MS,
    build: buildStamp,
    skipped: false,
    balances: { count: ACCOUNTS.length, saved: false },
    statements: { count: STATEMENT_LIMIT, saved: false },
    accountStatements: { count: statements, saved: true },
    autoTransfers: { count: 1, saved: false },
    errors: [],
  };
}

const SYNC_CONFIG: SyncConfig = {
  accountId: "dev0000000000000000000000000000",
  bucket: "aozora-history-dev",
  objectKey: DEFAULT_OBJECT_KEY,
  accessKeyId: "DEVACCESSKEYID",
  secretAccessKey: "dev-secret-access-key",
};

/**
 * シナリオぶんのダミー台帳。now を基準に組み立てるため、いつ開いても
 * 「当月」に記録が入っている
 */
export function dummyData(scenario: Scenario, now: number): DummyData {
  const world = simulate(SCENARIO_DAYS[scenario], now);
  const statements = limitStatements(world.statements);
  const empty = world.snapshots.length === 0;
  return {
    ledger: {
      snapshots: world.snapshots,
      transfers: world.transfers,
      statements,
      comments: world.comments,
      deletions: {},
    },
    autoTransfers: empty ? [] : [AUTO_TRANSFER],
    syncConfig: empty ? null : SYNC_CONFIG,
    lastCollect: collectReport(now, statements.length),
    debugMode: true,
  };
}
