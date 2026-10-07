/**
 * Typed ABIs, hand-copied from contracts/src/interfaces/*.sol (IPlansTypes, IPot, IPlansPeriphery, IFxReference).
 * Enums are uint8 on the ABI. Keep in sync with the interfaces; `pnpm sync-abi` additionally
 * pulls every custom error from contracts/out into src/abi.errors.generated.json for revert decoding.
 */
import { parseAbi } from "viem";

const structs = [
  "struct Rules { uint64 instantMax; uint64 oneApprovalMax; uint8 highTier; uint64 memberDailyCap; uint64 memberTotalCap; uint8 payeePolicy; uint64 minContribution; uint32 proposalTtl; uint32 ruleTimelock; uint64[8] categoryBudgets; }",
  "struct CreatePotParams { Rules rules; uint64 startTime; uint64 endTime; uint32 reviewWindow; address inviteSigner; bytes2 creatorCountry; uint256 creatorSafetyNet; bytes meta; bytes creatorKeyWrap; bytes inviteKeyWrap; bytes32 salt; }",
  "struct Auth3009 { uint256 value; uint256 validAfter; uint256 validBefore; bytes32 nonce; bytes signature; }",
  "struct Permit2612 { uint256 value; uint256 deadline; uint8 v; bytes32 r; bytes32 s; }",
  "struct KeyReg { bytes32 pubKey; uint256 deadline; bytes signature; }",
  "struct Split { address[] members; uint32[] weights; }",
  "struct KeyWrap { address member; bytes wrap; }",
  "struct SendMeta { address to; bytes2 fromCountry; bytes2 toCountry; bytes3 fromCurrency; bytes3 toCurrency; uint64 fxRateE8; uint64 fxTimestamp; uint64 fxRoundId; bytes32 memoHash; bytes32 salt; }",
] as const;

export const potAbi = parseAbi([
  ...structs,
  // events
  "event RulesSet(uint256 indexed version, Rules rules)",
  "event AllowlistChanged(address indexed payee, bool allowed)",
  "event MemberJoined(address indexed member, bytes2 country, uint256 safetyNet, uint256 memberIndex)",
  "event InviteRotated(address indexed by, address newSigner)",
  "event KeyWrapped(address indexed member, address indexed by, bytes wrap)",
  "event Contributed(address indexed member, uint256 amount)",
  "event SpendProposed(uint256 indexed id, address indexed proposer, uint8 kind, address payee, uint256 amount, uint8 category, address[] splitMembers, uint32[] splitWeights, bytes32 receiptHash, bytes memo, uint8 approvalsRequired, uint64 expiresAt)",
  "event Voted(uint256 indexed id, address indexed member, bool approve)",
  "event SpendApproved(uint256 indexed id)",
  "event SpendExecuted(uint256 indexed id, uint256 amount, address[] members, uint256[] shares, uint256 claimId)",
  "event SpendCancelled(uint256 indexed id, uint8 reason)",
  "event DisputeOpened(uint256 indexed disputeId, uint256 indexed spendId, address indexed by, uint8 reason, bytes memo)",
  "event DisputeVoted(uint256 indexed disputeId, address indexed member, bool spenderCovers)",
  "event DisputeResolved(uint256 indexed disputeId, uint8 outcome, address[] members, uint256[] shares)",
  "event Frozen(address indexed by, uint64 until)",
  "event Unfrozen(address indexed lastVoter)",
  "event RuleChangeProposed(uint256 indexed id, address indexed proposer, Rules rules, address[] allowAdd, address[] allowRemove, uint64 expiresAt)",
  "event RuleChangeVoted(uint256 indexed id, address indexed member, bool approve)",
  "event RuleChangeApproved(uint256 indexed id, uint64 eta)",
  "event RuleChangeApplied(uint256 indexed id, uint256 rulesVersion)",
  "event Acked(address indexed member, uint256 ackEpoch)",
  "event AcksReset(uint256 newAckEpoch)",
  "event Pulled(address indexed member, uint256 amount)",
  "event Payout(address indexed member, uint256 amount)",
  "event Collected(address indexed member, address indexed by, uint256 amount)",
  "event DebtRecorded(address indexed member, uint256 amount)",
  "event DebtPaid(address indexed member, uint256 amount)",
  "event MemberExited(address indexed member, int256 netAtExit, uint256 paidOut, uint256 pulledIn)",
  "event Settled(address indexed by, uint256 paidOut, uint256 pulledIn, uint256 unpaidClaims, uint64 fxRoundId)",
  "event EscrowRefunded(uint256 indexed spendId, uint256 amount)",
  // functions
  "function join(address member, bytes2 country, uint256 nonce, uint256 deadline, bytes memberSig, bytes inviteSig, Auth3009 deposit, Permit2612 safetyNet, KeyReg keyReg)",
  "function contribute(address member, Auth3009 auth)",
  "function rotateInvite(address member, address newSigner, uint256 nonce, uint256 deadline, bytes sig)",
  "function postKeyWraps(address member, KeyWrap[] wraps, uint256 nonce, uint256 deadline, bytes sig)",
  "function propose(address proposer, uint8 kind, address payee, uint256 amount, uint8 category, Split split, bytes32 receiptHash, bytes memo, uint256 nonce, uint256 deadline, bytes sig) returns (uint256 id)",
  "function vote(address member, uint256 id, bool approve, uint256 nonce, uint256 deadline, bytes sig)",
  "function cancelSpend(address member, uint256 id, uint256 nonce, uint256 deadline, bytes sig)",
  "function execute(uint256 id)",
  "function expire(uint256 id)",
  "function openDispute(address member, uint256 spendId, uint8 reason, bytes memo, uint256 nonce, uint256 deadline, bytes sig) returns (uint256 disputeId)",
  "function resolveDispute(address member, uint256 disputeId, uint8 outcome, Split split, uint256 nonce, uint256 deadline, bytes sig)",
  "function voteDispute(address member, uint256 disputeId, bool spenderCovers, uint256 nonce, uint256 deadline, bytes sig)",
  "function finalizeDispute(uint256 disputeId)",
  "function freeze(address member, uint256 nonce, uint256 deadline, bytes sig)",
  "function voteUnfreeze(address member, uint256 nonce, uint256 deadline, bytes sig)",
  "function proposeRules(address member, Rules rules, address[] allowAdd, address[] allowRemove, uint256 nonce, uint256 deadline, bytes sig) returns (uint256 id)",
  "function voteRules(address member, uint256 id, bool approve, uint256 nonce, uint256 deadline, bytes sig)",
  "function applyRules(uint256 id)",
  "function exit(address member, uint256 nonce, uint256 deadline, bytes sig)",
  "function ack(address member, uint256 nonce, uint256 deadline, bytes sig)",
  "function settle()",
  "function payDebt(address member, Auth3009 auth)",
  "function collect(address member)",
  "function previewSpend(address proposer, uint8 kind, address payee, uint256 amount, uint8 category) view returns (uint8 approvalsRequired, bool ok, uint8 reason)",
  "function netOf(address member) view returns (int256)",
  "function isMember(address account) view returns (bool)",
  "function activeMemberCount() view returns (uint256)",
  "function canSettle() view returns (bool)",
  "function settled() view returns (bool)",
  "function usedNonce(address member, uint256 nonce) view returns (bool)",
  "function fxReference() view returns (address)",
  "function MAX_FX_AGE() view returns (uint256)",
  // custom errors documented in docs/protocol.md
  "error SpendBlocked(uint8 reason)",
]);

export const factoryAbi = parseAbi([
  ...structs,
  "event PotCreated(address indexed pot, address indexed creator, uint64 startTime, uint64 endTime, uint32 reviewWindow, bytes meta, bytes inviteKeyWrap)",
  "function createPot(address creator, CreatePotParams params, uint256 nonce, uint256 deadline, bytes sig, Auth3009 deposit, Permit2612 safetyNet, KeyReg keyReg) returns (address pot)",
  "function predictPot(address creator, bytes32 salt) view returns (address)",
  "function isPot(address pot) view returns (bool)",
  "function ausd() view returns (address)",
  "function keyRegistry() view returns (address)",
  "function claimEscrow() view returns (address)",
  "function fxReference() view returns (address)",
]);

export const keyRegistryAbi = parseAbi([
  "event KeyRegistered(address indexed account, bytes32 pubKey)",
  "function register(address account, bytes32 pubKey, uint256 deadline, bytes sig)",
  "function keyOf(address account) view returns (bytes32)",
]);

export const claimEscrowAbi = parseAbi([
  ...structs,
  "event ClaimCreated(uint256 indexed id, address indexed source, address indexed claimSigner, uint256 amount, uint64 expiry, uint256 sourceSpendId, bytes2 fromCountry)",
  "event Claimed(uint256 indexed id, address indexed recipient, bytes2 toCountry)",
  "event ClaimRefunded(uint256 indexed id, address indexed to, uint256 amount)",
  "function createFromPot(address claimSigner, uint256 amount, uint64 expiry, uint256 spendId) returns (uint256 id)",
  "function createWithAuthorization(address from, address claimSigner, uint64 expiry, bytes2 fromCountry, bytes32 salt, Auth3009 auth) returns (uint256 id)",
  "function claim(uint256 id, address recipient, bytes2 toCountry, bytes claimSig)",
  "function refund(uint256 id)",
]);

export const plansSendAbi = parseAbi([
  ...structs,
  "event Sent(address indexed from, address indexed to, uint256 amount, bytes2 fromCountry, bytes2 toCountry, bytes3 fromCurrency, bytes3 toCurrency, uint64 fxRateE8, uint64 fxTimestamp, bytes32 memoHash, uint64 fxRoundId, uint256 refRateE8, int256 fxDiffBps)",
  "function send(address from, SendMeta meta, Auth3009 auth)",
  "function ausd() view returns (address)",
  "function fxReference() view returns (address)",
  "function MAX_FX_AGE() view returns (uint256)",
  "function previewReference(SendMeta meta) view returns (uint256 refRateE8, int256 diffBps)",
  "error FxRoundUnknown(uint64 roundId)",
  "error FxRoundStale(uint64 roundId, uint64 scheduledTime)",
  "error FxPairUnavailable(uint64 roundId, bytes3 fromCurrency, bytes3 toCurrency)",
]);

/**
 * FxReference (contracts/src/interfaces/IFxReference.sol): reference FX rounds written by a
 * Chainlink CRE workflow. Read-only for the relayer: it never calls onReport or the owner setters.
 * Rates are USD per 1 unit of the currency, 8 decimals, in the fixed order of `currencies()`.
 */
export const fxReferenceAbi = parseAbi([
  "struct Round { uint64 roundId; uint64 scheduledTime; uint64 writtenAt; uint32 rateDate; uint8 sourceMask; bytes3[] currencies; uint64[] usdPerUnitE8; uint8[] sourceMasks; }",
  "event RoundWritten(uint64 indexed roundId, uint64 scheduledTime, uint32 rateDate, uint8 sourceMask, uint64[] usdPerUnitE8, uint8[] sourceMasks)",
  "event SimulationModeSet(address indexed forwarder, address indexed simTransmitter)",
  "event ProductionModeSet(address indexed forwarder, bytes32 indexed workflowId, address indexed workflowOwner)",
  "event MaxMoveSet(uint16 maxMoveBps)",
  "function latestRound() view returns (Round)",
  "function round(uint64 id) view returns (Round)",
  "function rateOf(uint64 id, bytes3 ccy) view returns (uint64)",
  "function latestRoundTime() view returns (uint64 roundId, uint64 scheduledTime)",
  "function roundTime(uint64 id) view returns (uint64 scheduledTime)",
  "function latestRoundId() view returns (uint64)",
  "function currencies() view returns (bytes3[])",
  "function forwarder() view returns (address)",
  "function simTransmitter() view returns (address)",
  "function maxMoveBps() view returns (uint16)",
  "function CHAIN_SELECTOR() view returns (uint64)",
]);

export const ausdAbi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
  "event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address, address) view returns (uint256)",
  "function transfer(address, uint256) returns (bool)",
  "function transferFrom(address, address, uint256) returns (bool)",
  "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
  "function receiveWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes signature)",
  "function nonces(address) view returns (uint256)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
]);

export const faucetAbi = parseAbi(["function requestFunds(address)"]);

/** Errors we know about independent of the generated file (Solady and common token errors). */
export const commonErrorsAbi = parseAbi([
  "error SpendBlocked(uint8 reason)",
  "error TransferFailed()",
  "error TransferFromFailed()",
  "error ApproveFailed()",
  "error ETHTransferFailed()",
  "error Unauthorized()",
  "error Reentrancy()",
  "error InvalidSignature()",
  "error UsedOrCanceledAuthorization()",
  "error ExpiredAuthorization()",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
  "error ERC2612ExpiredSignature(uint256 deadline)",
  "error ERC2612InvalidSigner(address signer, address owner)",
  "error InsufficientBalance()",
  "error InsufficientAllowance()",
  "error InvalidPermit()",
  "error PermitExpired()",
]);

/** Every event the relayer can decode in a receipt. */
export const allEventsAbi = [
  ...potAbi.filter((x) => x.type === "event"),
  ...factoryAbi.filter((x) => x.type === "event"),
  ...keyRegistryAbi.filter((x) => x.type === "event"),
  ...claimEscrowAbi.filter((x) => x.type === "event"),
  ...plansSendAbi.filter((x) => x.type === "event"),
  ...fxReferenceAbi.filter((x) => x.type === "event"),
  ...ausdAbi.filter((x) => x.type === "event"),
] as const;
