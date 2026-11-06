// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title SkinPactMarket (S1 + S2-mini)
/// @notice Testnet-only escrow for a single CS2 item listing. Steam delivery is
///         observed off-chain; this contract never claims to verify Steam.
/// @dev S2-mini adds seller cancellation and an arbiter-backed dispute path so
///      no non-terminal state can lock escrow forever. Steam evidence remains
///      off-chain; the arbiter is a disclosed trust point.
contract SkinPactMarket is ReentrancyGuard {
    enum Status {
        None,
        Active,
        Funded,
        OfferSent,
        ClaimPending,
        Completed,
        Refunded,
        Disputed,
        Cancelled
    }

    struct Listing {
        address seller;
        address buyer;
        uint256 price;
        uint256 bond;
        bytes32 itemHash;
        bytes32 offerIdHash;
        bytes32 evidenceHash;
        uint64 offerDeadline;
        uint64 challengeDeadline;
        Status status;
        uint64 deliveryDeadline;
        bytes32 disputeHash;
        address disputer;
    }

    uint256 public immutable maxPrice;
    uint256 public immutable minBond;
    uint64 public immutable offerWindow;
    uint64 public immutable challengeWindow;
    uint64 public immutable deliveryWindow;
    address public immutable arbiter;

    uint256 public nextListingId = 1;

    mapping(uint256 => Listing) private _listings;
    mapping(bytes32 => uint256) public activeItemHash;
    mapping(bytes32 => bool) public usedOfferIdHash;
    mapping(address => uint256) public withdrawable;

    event ListingCreated(
        uint256 indexed listingId,
        address indexed seller,
        bytes32 indexed itemHash,
        uint256 price,
        uint256 bond
    );
    event ListingBought(uint256 indexed listingId, address indexed buyer, uint256 price);
    event OfferMarked(uint256 indexed listingId, bytes32 offerIdHash);
    event ReceiptConfirmed(uint256 indexed listingId, address indexed buyer);
    event ClaimAccepted(uint256 indexed listingId, bytes32 evidenceHash, uint64 challengeDeadline);
    event ClaimFinalized(uint256 indexed listingId);
    event OrderExpired(uint256 indexed listingId);
    event ListingCancelled(uint256 indexed listingId, address indexed seller);
    event DisputeOpened(uint256 indexed listingId, address indexed disputer, bytes32 disputeHash);
    event DisputeResolved(uint256 indexed listingId, bool sellerWins, bool bondToBuyer);
    event Withdrawn(address indexed account, uint256 amount);

    error InvalidConfig();
    error InvalidPrice();
    error InvalidItemHash();
    error ItemAlreadyListed();
    error IncorrectBond();
    error IncorrectPrice();
    error UnknownListing();
    error NotActive();
    error NotFunded();
    error NotOfferSent();
    error NotClaimPending();
    error NotDisputed();
    error NotSeller();
    error NotBuyer();
    error NotArbiter();
    error SelfBuy();
    error InvalidStatus();
    error InvalidOfferHash();
    error InvalidEvidenceHash();
    error InvalidDisputeHash();
    error InvalidResolution();
    error OfferHashAlreadyUsed();
    error OfferDeadlinePassed();
    error OfferDeadlineNotReached();
    error ChallengeNotExpired();
    error DisputeDeadlinePassed();
    error DisputeNotAllowed();
    error NothingToWithdraw();
    error WithdrawFailed();

    constructor(
        uint256 maxPrice_,
        uint256 minBond_,
        uint64 offerWindow_,
        uint64 challengeWindow_,
        uint64 deliveryWindow_,
        address arbiter_
    ) {
        if (
            maxPrice_ == 0 ||
            minBond_ == 0 ||
            offerWindow_ == 0 ||
            challengeWindow_ == 0 ||
            deliveryWindow_ == 0 ||
            arbiter_ == address(0)
        ) revert InvalidConfig();

        maxPrice = maxPrice_;
        minBond = minBond_;
        offerWindow = offerWindow_;
        challengeWindow = challengeWindow_;
        deliveryWindow = deliveryWindow_;
        arbiter = arbiter_;
    }

    function quoteBond(uint256 price) public view returns (uint256) {
        uint256 proportional = price / 10;
        return proportional > minBond ? proportional : minBond;
    }

    function createListing(bytes32 itemHash, uint256 price) external payable returns (uint256) {
        if (price == 0 || price > maxPrice) revert InvalidPrice();
        if (itemHash == bytes32(0)) revert InvalidItemHash();
        if (activeItemHash[itemHash] != 0) revert ItemAlreadyListed();

        uint256 bond = quoteBond(price);
        if (msg.value != bond) revert IncorrectBond();

        uint256 listingId = nextListingId++;
        _listings[listingId] = Listing({
            seller: msg.sender,
            buyer: address(0),
            price: price,
            bond: bond,
            itemHash: itemHash,
            offerIdHash: bytes32(0),
            evidenceHash: bytes32(0),
            offerDeadline: 0,
            challengeDeadline: 0,
            status: Status.Active,
            deliveryDeadline: 0,
            disputeHash: bytes32(0),
            disputer: address(0)
        });
        activeItemHash[itemHash] = listingId;

        emit ListingCreated(listingId, msg.sender, itemHash, price, bond);
        return listingId;
    }

    function buy(uint256 listingId) external payable {
        Listing storage listing = _get(listingId);
        if (listing.status != Status.Active) revert NotActive();
        if (msg.sender == listing.seller) revert SelfBuy();
        if (msg.value != listing.price) revert IncorrectPrice();

        listing.buyer = msg.sender;
        listing.offerDeadline = uint64(block.timestamp) + offerWindow;
        listing.status = Status.Funded;

        emit ListingBought(listingId, msg.sender, listing.price);
    }

    /// @notice The seller's declaration that an offer was created. This never
    ///         releases escrow. It also starts the window after which anyone can
    ///         escalate a stuck order to the arbiter.
    function markOfferSent(uint256 listingId, bytes32 offerIdHash) external {
        Listing storage listing = _get(listingId);
        if (msg.sender != listing.seller) revert NotSeller();
        if (listing.status != Status.Funded) revert NotFunded();
        if (block.timestamp >= listing.offerDeadline) revert OfferDeadlinePassed();
        if (offerIdHash == bytes32(0)) revert InvalidOfferHash();
        if (usedOfferIdHash[offerIdHash]) revert OfferHashAlreadyUsed();

        usedOfferIdHash[offerIdHash] = true;
        listing.offerIdHash = offerIdHash;
        listing.deliveryDeadline = uint64(block.timestamp) + deliveryWindow;
        listing.status = Status.OfferSent;

        emit OfferMarked(listingId, offerIdHash);
    }

    /// @notice Buyer fast path. Allowed in Funded (seller forgot to mark),
    ///         OfferSent, or ClaimPending. Irreversible. Disputed orders can
    ///         only be settled by the arbiter.
    function confirmReceipt(uint256 listingId) external {
        Listing storage listing = _get(listingId);
        if (msg.sender != listing.buyer) revert NotBuyer();
        if (
            listing.status != Status.Funded &&
            listing.status != Status.OfferSent &&
            listing.status != Status.ClaimPending
        ) revert InvalidStatus();

        _settleSeller(listingId, listing);
        emit ReceiptConfirmed(listingId, msg.sender);
    }

    /// @notice Seller declares it observed Steam Accepted(3). No payout here;
    ///         buyer can confirm, or anyone can finalize after the challenge.
    function claimAccepted(uint256 listingId, bytes32 evidenceHash) external {
        Listing storage listing = _get(listingId);
        if (msg.sender != listing.seller) revert NotSeller();
        if (listing.status != Status.OfferSent) revert NotOfferSent();
        if (evidenceHash == bytes32(0)) revert InvalidEvidenceHash();

        listing.evidenceHash = evidenceHash;
        listing.challengeDeadline = uint64(block.timestamp) + challengeWindow;
        listing.status = Status.ClaimPending;

        emit ClaimAccepted(listingId, evidenceHash, listing.challengeDeadline);
    }

    function finalizeClaim(uint256 listingId) external {
        Listing storage listing = _get(listingId);
        if (listing.status != Status.ClaimPending) revert NotClaimPending();
        if (block.timestamp < listing.challengeDeadline) revert ChallengeNotExpired();

        _settleSeller(listingId, listing);
        emit ClaimFinalized(listingId);
    }

    /// @notice Permissionless refund when no offer was marked in time.
    function expireOrder(uint256 listingId) external {
        Listing storage listing = _get(listingId);
        if (listing.status != Status.Funded) revert NotFunded();
        if (block.timestamp < listing.offerDeadline) revert OfferDeadlineNotReached();

        listing.status = Status.Refunded;
        _clearActiveItem(listingId, listing);
        withdrawable[listing.buyer] += listing.price;
        withdrawable[listing.seller] += listing.bond;

        emit OrderExpired(listingId);
    }

    /// @notice Seller can withdraw an unsold listing and recover the bond.
    function cancelListing(uint256 listingId) external {
        Listing storage listing = _get(listingId);
        if (msg.sender != listing.seller) revert NotSeller();
        if (listing.status != Status.Active) revert NotActive();

        listing.status = Status.Cancelled;
        _clearActiveItem(listingId, listing);
        withdrawable[listing.seller] += listing.bond;

        emit ListingCancelled(listingId, msg.sender);
    }

    /// @notice Opens an off-chain-evidence dispute. The evidence itself is not
    ///         stored on-chain; disputeHash is a commitment reviewed by the
    ///         arbiter. OfferSent: either party before deliveryDeadline, anyone
    ///         after it. ClaimPending: only the buyer before challengeDeadline.
    function openDispute(uint256 listingId, bytes32 evidenceHash) external {
        Listing storage listing = _get(listingId);
        if (evidenceHash == bytes32(0)) revert InvalidDisputeHash();

        if (listing.status == Status.OfferSent) {
            bool isParty = msg.sender == listing.seller || msg.sender == listing.buyer;
            if (!isParty && block.timestamp < listing.deliveryDeadline) {
                revert DisputeNotAllowed();
            }
        } else if (listing.status == Status.ClaimPending) {
            if (msg.sender != listing.buyer) revert NotBuyer();
            if (block.timestamp >= listing.challengeDeadline) revert DisputeDeadlinePassed();
        } else {
            revert InvalidStatus();
        }

        listing.disputeHash = evidenceHash;
        listing.disputer = msg.sender;
        listing.status = Status.Disputed;

        emit DisputeOpened(listingId, msg.sender, evidenceHash);
    }

    /// @notice Arbiter resolves a dispute. A seller win releases price + bond to
    ///         the seller. A buyer win refunds the price, and optionally awards
    ///         the seller bond to the buyer as compensation.
    function resolveDispute(
        uint256 listingId,
        bool sellerWins,
        bool bondToBuyer
    ) external {
        Listing storage listing = _get(listingId);
        if (msg.sender != arbiter) revert NotArbiter();
        if (listing.status != Status.Disputed) revert NotDisputed();
        if (sellerWins && bondToBuyer) revert InvalidResolution();

        if (sellerWins) {
            _settleSeller(listingId, listing);
        } else {
            listing.status = Status.Refunded;
            _clearActiveItem(listingId, listing);
            withdrawable[listing.buyer] += listing.price;
            if (bondToBuyer) {
                withdrawable[listing.buyer] += listing.bond;
            } else {
                withdrawable[listing.seller] += listing.bond;
            }
        }

        emit DisputeResolved(listingId, sellerWins, bondToBuyer);
    }

    function withdraw() external nonReentrant {
        uint256 amount = withdrawable[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        withdrawable[msg.sender] = 0;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert WithdrawFailed();

        emit Withdrawn(msg.sender, amount);
    }

    function getListing(uint256 listingId) external view returns (Listing memory) {
        return _listings[listingId];
    }

    function _get(uint256 listingId) private view returns (Listing storage) {
        if (listingId == 0 || listingId >= nextListingId) revert UnknownListing();
        return _listings[listingId];
    }

    function _settleSeller(uint256 listingId, Listing storage listing) private {
        listing.status = Status.Completed;
        _clearActiveItem(listingId, listing);
        withdrawable[listing.seller] += listing.price + listing.bond;
    }

    function _clearActiveItem(uint256 listingId, Listing storage listing) private {
        if (activeItemHash[listing.itemHash] == listingId) {
            delete activeItemHash[listing.itemHash];
        }
    }
}
