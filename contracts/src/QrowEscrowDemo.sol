// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {QorePQC} from "./IQorePQC.sol";
import {IQrowKeys} from "./PqAuth.sol";

interface IERC20Minimal {
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title  QrowEscrowDemo: DEMO COPY of QrowEscrow with a 10-minute refund period (not for real use)
/// @notice A sender locks native QOR or an ERC-20 for a recipient. The recipient claims within
///         7 days, or anyone can trigger the refund to the sender afterwards.
///
///         Every sensitive action (create, cancel, claim, release, setLimits) needs, in addition
///         to the normal ECDSA-signed EVM transaction from the right address, an ML-DSA-87
///         signature by that same address's key registered on QoreChain (checked through the
///         pqcKeyStatus + pqcVerify precompiles). A leaked secp256k1 key alone can therefore not
///         create, cancel, claim, release or change limits.
///
///         There is no owner, no admin, no pause and no upgrade path: nobody can move user funds
///         except along the rules below.
contract QrowEscrowDemo {
    // ------------------------------------------------------------------ types

    enum Mode {
        Direct, // recipient claims with a PQ signature
        Freelancer // funds move only when the sender calls release()
    }

    enum Status {
        None,
        Pending,
        Claimed,
        Released,
        Cancelled,
        Refunded
    }

    struct Payment {
        address sender;
        address recipient;
        address token; // address(0) = native QOR
        uint256 amount;
        uint64 createdAt;
        uint64 deadline;
        Mode mode;
        Status status;
    }

    struct Limits {
        uint256 maxPerPayment; // 0 = no limit
        uint256 maxPerDay; // 0 = no limit
    }

    struct DailySpend {
        uint64 day; // block.timestamp / 1 days
        uint256 spent;
    }

    // ------------------------------------------------------------------ constants

    /// @dev DEMO ONLY: identical to QrowEscrow except this period, so a refund can be shown in minutes.
    uint64 public constant REFUND_PERIOD = 10 minutes;
    /// @notice A PQ authorisation may be valid for at most this long after signing time.
    uint64 public constant MAX_SIG_VALIDITY = 1 hours;

    bytes32 public constant DOMAIN_TAG = keccak256("QROW_ESCROW_DEMO_V1");
    bytes32 public constant ACTION_CREATE = keccak256("CREATE");
    bytes32 public constant ACTION_CANCEL = keccak256("CANCEL");
    bytes32 public constant ACTION_CLAIM = keccak256("CLAIM");
    bytes32 public constant ACTION_RELEASE = keccak256("RELEASE");
    bytes32 public constant ACTION_SET_LIMITS = keccak256("SET_LIMITS");

    // ------------------------------------------------------------------ storage

    uint256 public paymentCount;
    mapping(uint256 => Payment) private _payments;

    /// @notice Per-signer PQ nonce; every accepted PQ authorisation consumes one.
    mapping(address => uint256) public pqNonce;

    mapping(address => mapping(address => Limits)) private _limits; // sender => token => limits
    mapping(address => mapping(address => DailySpend)) private _daily; // sender => token => spend

    /// @notice Native refunds that could not be pushed (sender rejects QOR) wait here.
    mapping(address => uint256) public owedNative;

    uint256 private _lock = 1;

    /// @notice QoreChain native chain id this deployment signs for, e.g. "qorechain-diana".
    string public nativeChainId;
    /// @dev "qorechain-msg-v1|" + nativeChainId + "|": QoreSign's message-signing domain
    ///      (messagePqSignBytes), the same bytes QoreX's planned signArbitrary will sign.
    bytes private _msgPrefix;
    /// @notice Shared key registry: a signer's Qrow app key, else its chain key (address(0): chain keys only).
    IQrowKeys public immutable KEYS;

    bytes16 private constant HEX = "0123456789abcdef";

    error InvalidChainId();

    /// @param nativeChainId_ the QoreChain native chain id matching this EVM chain
    ///        ("qorechain-diana" for EVM chain id 9800). Fixed for the contract's lifetime.
    constructor(string memory nativeChainId_, address keys_) {
        KEYS = IQrowKeys(keys_);
        bytes memory id = bytes(nativeChainId_);
        if (id.length == 0 || id.length > 64) revert InvalidChainId();
        for (uint256 i = 0; i < id.length; i++) {
            bytes1 c = id[i];
            bool ok = (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c == "." || c == "_"
                || c == "-";
            if (!ok) revert InvalidChainId();
        }
        nativeChainId = nativeChainId_;
        _msgPrefix = abi.encodePacked("qorechain-msg-v1|", nativeChainId_, "|");
    }

    // ------------------------------------------------------------------ events

    event PaymentCreated(
        uint256 indexed id,
        address indexed sender,
        address indexed recipient,
        address token,
        uint256 amount,
        uint64 deadline,
        Mode mode
    );
    /// @notice QoreSeal (ML-KEM-1024) envelope for the recipient; not stored, only logged.
    event PaymentNote(uint256 indexed id, address indexed recipient, bytes sealedNote);
    event PaymentClaimed(uint256 indexed id, address indexed recipient, uint256 amount);
    event PaymentReleased(uint256 indexed id, address indexed recipient, uint256 amount);
    event PaymentCancelled(uint256 indexed id, address indexed sender, uint256 amount);
    event PaymentRefunded(uint256 indexed id, address indexed sender, uint256 amount, address indexed caller);
    event LimitsSet(address indexed sender, address indexed token, uint256 maxPerPayment, uint256 maxPerDay);
    event NativeOwed(address indexed sender, uint256 amount);
    event OwedWithdrawn(address indexed sender, uint256 amount);

    // ------------------------------------------------------------------ errors

    error Reentrancy();
    error InvalidRecipient();
    error InvalidAmount();
    error InvalidToken();
    error NonStandardToken();
    error BadValue();
    error UnknownPayment();
    error NotPending();
    error NotSender();
    error NotRecipient();
    error WrongMode();
    error Expired();
    error NotExpired();
    error NoPqKey();
    error BadPqSignature();
    error SignatureExpired();
    error SignatureTooLong();
    error OverPaymentLimit();
    error OverDailyLimit();
    error TransferFailed();
    error NothingOwed();

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    // ================================================================== actions

    /// @notice Lock funds for `recipient`. Refundable to the sender after 7 days if not claimed.
    /// @param token      address(0) for native QOR (send `amount` as msg.value), else an ERC-20
    ///                   already approved to this contract.
    /// @param sealedNote optional QoreSeal envelope for the recipient (logged in PaymentNote).
    /// @param validUntil last timestamp the PQ authorisation is valid.
    /// @param pqSig      ML-DSA-87 signature by msg.sender over createDigest(...).
    function createPayment(
        address recipient,
        address token,
        uint256 amount,
        Mode mode,
        bytes calldata sealedNote,
        uint64 validUntil,
        bytes calldata pqSig
    ) external payable nonReentrant returns (uint256 id) {
        if (recipient == address(0) || recipient == msg.sender || recipient == address(this)) {
            revert InvalidRecipient();
        }
        if (amount == 0) revert InvalidAmount();
        if (token == address(0) ? msg.value != amount : msg.value != 0) revert BadValue();

        _requirePq(
            msg.sender,
            ACTION_CREATE,
            keccak256(abi.encode(recipient, token, amount, mode, keccak256(sealedNote))),
            validUntil,
            pqSig
        );

        if (token != address(0) && token.code.length == 0) revert InvalidToken();
        _checkAndRecordLimits(msg.sender, token, amount);

        // Effects: the payment is fully recorded before any external call.
        id = ++paymentCount;
        uint64 deadline = uint64(block.timestamp) + REFUND_PERIOD;
        _payments[id] = Payment({
            sender: msg.sender,
            recipient: recipient,
            token: token,
            amount: amount,
            createdAt: uint64(block.timestamp),
            deadline: deadline,
            mode: mode,
            status: Status.Pending
        });
        emit PaymentCreated(id, msg.sender, recipient, token, amount, deadline, mode);
        if (sealedNote.length != 0) emit PaymentNote(id, recipient, sealedNote);

        // Interaction last. The escrow must receive exactly `amount`: fee-on-transfer, rebasing or
        // otherwise non-standard tokens revert the whole payment, so the escrow never owes more than it holds.
        if (token != address(0)) {
            uint256 beforeBal = IERC20Minimal(token).balanceOf(address(this));
            _safeTransferFrom(token, msg.sender, address(this), amount);
            if (IERC20Minimal(token).balanceOf(address(this)) - beforeBal != amount) revert NonStandardToken();
        }
    }

    /// @notice Sender takes a pending payment back before it is claimed/released.
    function cancel(uint256 id, uint64 validUntil, bytes calldata pqSig) external nonReentrant {
        Payment storage p = _pending(id);
        if (msg.sender != p.sender) revert NotSender();
        _requirePq(msg.sender, ACTION_CANCEL, keccak256(abi.encode(id)), validUntil, pqSig);

        p.status = Status.Cancelled;
        uint256 amount = p.amount;
        emit PaymentCancelled(id, p.sender, amount);
        _payOut(p.token, p.sender, amount, false);
    }

    /// @notice Recipient claims a Direct-mode payment before the deadline.
    function claim(uint256 id, uint64 validUntil, bytes calldata pqSig) external nonReentrant {
        Payment storage p = _pending(id);
        if (msg.sender != p.recipient) revert NotRecipient();
        if (p.mode != Mode.Direct) revert WrongMode();
        if (block.timestamp >= p.deadline) revert Expired();
        _requirePq(msg.sender, ACTION_CLAIM, keccak256(abi.encode(id)), validUntil, pqSig);

        p.status = Status.Claimed;
        uint256 amount = p.amount;
        emit PaymentClaimed(id, p.recipient, amount);
        _payOut(p.token, p.recipient, amount, false);
    }

    /// @notice Sender releases a Freelancer-mode payment to the recipient before the deadline.
    function release(uint256 id, uint64 validUntil, bytes calldata pqSig) external nonReentrant {
        Payment storage p = _pending(id);
        if (msg.sender != p.sender) revert NotSender();
        if (p.mode != Mode.Freelancer) revert WrongMode();
        if (block.timestamp >= p.deadline) revert Expired();
        _requirePq(msg.sender, ACTION_RELEASE, keccak256(abi.encode(id)), validUntil, pqSig);

        p.status = Status.Released;
        uint256 amount = p.amount;
        emit PaymentReleased(id, p.recipient, amount);
        _payOut(p.token, p.recipient, amount, false);
    }

    /// @notice After the deadline, anyone can return an unclaimed payment to its sender.
    ///         Funds can only ever go to the original sender, so no signature is needed.
    function refundExpired(uint256 id) external nonReentrant {
        Payment storage p = _pending(id);
        if (block.timestamp < p.deadline) revert NotExpired();

        p.status = Status.Refunded;
        uint256 amount = p.amount;
        emit PaymentRefunded(id, p.sender, amount, msg.sender);
        // A sender that rejects native QOR must not block the refund: credit it instead.
        _payOut(p.token, p.sender, amount, true);
    }

    /// @notice Withdraw native QOR credited by a refund that could not be pushed.
    ///         Always pays msg.sender, so it cannot be redirected.
    function withdrawOwed() external nonReentrant {
        uint256 amount = owedNative[msg.sender];
        if (amount == 0) revert NothingOwed();
        owedNative[msg.sender] = 0;
        emit OwedWithdrawn(msg.sender, amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /// @notice Sender sets their own limits for one token (address(0) = native QOR). 0 = unlimited.
    function setLimits(address token, uint256 maxPerPayment, uint256 maxPerDay, uint64 validUntil, bytes calldata pqSig)
        external
        nonReentrant
    {
        _requirePq(
            msg.sender, ACTION_SET_LIMITS, keccak256(abi.encode(token, maxPerPayment, maxPerDay)), validUntil, pqSig
        );
        _limits[msg.sender][token] = Limits(maxPerPayment, maxPerDay);
        emit LimitsSet(msg.sender, token, maxPerPayment, maxPerDay);
    }

    // ================================================================== views

    function getPayment(uint256 id) external view returns (Payment memory) {
        return _payments[id];
    }

    function limitsOf(address sender, address token) external view returns (Limits memory) {
        return _limits[sender][token];
    }

    /// @notice Amount the sender has already sent today for `token` (UTC day buckets).
    function spentToday(address sender, address token) public view returns (uint256) {
        DailySpend memory d = _daily[sender][token];
        return d.day == block.timestamp / 1 days ? d.spent : 0;
    }

    /// @notice Whether `account` has an ML-DSA-87 key registered with proof of possession.
    function pqKeyOf(address account) public view returns (bytes memory) {
        if (address(KEYS) == address(0)) return QorePQC.provenKey(account);
        return KEYS.keyOf(account);
    }

    function hasPqKey(address account) external view returns (bool) {
        return pqKeyOf(account).length != 0;
    }

    /// @notice The 32-byte digest of an action. The ML-DSA-87 key signs pqMessage(digest).
    /// @param paramsHash keccak256(abi.encode(...)) of the action's parameters:
    ///   CREATE:     (recipient, token, amount, mode, keccak256(sealedNote))
    ///   CANCEL / CLAIM / RELEASE: (id)
    ///   SET_LIMITS: (token, maxPerPayment, maxPerDay)
    function actionDigest(bytes32 action, address signer, uint256 nonce, uint64 validUntil, bytes32 paramsHash)
        public
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(DOMAIN_TAG, block.chainid, address(this), action, signer, nonce, validUntil, paramsHash));
    }

    /// @notice The exact bytes the ML-DSA-87 key signs for a digest: QoreSign's
    ///         messagePqSignBytes(nativeChainId, "0x" + lowercase hex of the digest).
    ///         The data part is 66 ASCII characters, so a wallet can show it as text.
    function pqMessage(bytes32 digest) public view returns (bytes memory) {
        bytes memory hexStr = new bytes(66);
        hexStr[0] = "0";
        hexStr[1] = "x";
        for (uint256 i = 0; i < 32; i++) {
            uint8 b = uint8(digest[i]);
            hexStr[2 + 2 * i] = HEX[b >> 4];
            hexStr[3 + 2 * i] = HEX[b & 0x0f];
        }
        return abi.encodePacked(_msgPrefix, hexStr);
    }

    // ================================================================== internals

    function _pending(uint256 id) private view returns (Payment storage p) {
        p = _payments[id];
        if (p.status == Status.None) revert UnknownPayment();
        if (p.status != Status.Pending) revert NotPending();
    }

    function _requirePq(address signer, bytes32 action, bytes32 paramsHash, uint64 validUntil, bytes calldata sig)
        private
    {
        if (block.timestamp > validUntil) revert SignatureExpired();
        if (validUntil > block.timestamp + MAX_SIG_VALIDITY) revert SignatureTooLong();

        bytes memory pubkey = pqKeyOf(signer);
        if (pubkey.length == 0) revert NoPqKey();

        uint256 nonce = pqNonce[signer];
        bytes32 digest = actionDigest(action, signer, nonce, validUntil, paramsHash);
        if (!QorePQC.verify(pubkey, sig, pqMessage(digest))) revert BadPqSignature();
        pqNonce[signer] = nonce + 1;
    }

    function _checkAndRecordLimits(address sender, address token, uint256 amount) private {
        Limits memory l = _limits[sender][token];
        if (l.maxPerPayment != 0 && amount > l.maxPerPayment) revert OverPaymentLimit();

        uint64 today = uint64(block.timestamp / 1 days);
        DailySpend storage d = _daily[sender][token];
        uint256 spent = d.day == today ? d.spent : 0;
        if (l.maxPerDay != 0 && spent + amount > l.maxPerDay) revert OverDailyLimit();
        d.day = today;
        d.spent = spent + amount;
    }

    function _payOut(address token, address to, uint256 amount, bool creditOnNativeFailure) private {
        if (token == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) {
                if (!creditOnNativeFailure) revert TransferFailed();
                owedNative[to] += amount;
                emit NativeOwed(to, amount);
            }
        } else {
            _safeTransfer(token, to, amount);
        }
    }

    function _safeTransfer(address token, address to, uint256 amount) private {
        (bool ok, bytes memory ret) = token.call(abi.encodeCall(IERC20Minimal.transfer, (to, amount)));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool))) || token.code.length == 0) revert TransferFailed();
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) private {
        (bool ok, bytes memory ret) =
            token.call(abi.encodeCall(IERC20Minimal.transferFrom, (from, to, amount)));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool))) || token.code.length == 0) revert TransferFailed();
    }
}
