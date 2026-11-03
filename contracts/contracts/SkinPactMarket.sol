// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title SkinPactMarket (S1 vertical slice)
/// @notice Testnet-only escrow for a single CS2 item listing. Steam delivery is
///         observed off-chain; this contract never claims to verify Steam.
/// @dev S1 intentionally omits Dispute/Arbiter/abort/cancel. Do not deploy this
///      version to a public network; S2 adds those paths before Sepolia.
contract SkinPactMarket is ReentrancyGuard {
    enum Status {
        None,
        Active,
        Funded,
        OfferSent,
        ClaimPending,
        Completed,
        Refunded
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
    }

    uint256 public immutable maxPrice;
    uint256 public immutable minBond;
    uint64 public immutable offerWindow;
    uint64 public immutable challengeWindow;

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
    error NotSeller();
    error NotBuyer();
    error SelfBuy();
    error InvalidStatus();
    error InvalidOfferHash();
    error InvalidEvidenceHash();
    error OfferHashAlreadyUsed();
    error OfferDeadlinePassed();
    error OfferDeadlineNotReached();
    error ChallengeNotExpired();
    error NothingToWithdraw();
    error WithdrawFailed();

    constructor(
        uint256 maxPrice_,
        uint256 minBond_,
        uint64 offerWindow_,
        uint64 challengeWindow_
    ) {
        if (maxPrice_ == 0 || minBond_ == 0 || offerWindow_ == 0 || challengeWindow_ == 0) {
            revert InvalidConfig();
        }
        maxPrice = maxPrice_;
        minBond = minBond_;
        offerWindow = offerWindow_;
        challengeWindow = challengeWindow_;
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
            status: Status.Active
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
    ///         releases escrow.
    function markOfferSent(uint256 listingId, bytes32 offerIdHash) external {
        Listing storage listing = _get(listingId);
        if (msg.sender != listing.seller) revert NotSeller();
        if (listing.status != Status.Funded) revert NotFunded();
        if (block.timestamp >= listing.offerDeadline) revert OfferDeadlinePassed();
        if (offerIdHash == bytes32(0)) revert InvalidOfferHash();
        if (usedOfferIdHash[offerIdHash]) revert OfferHashAlreadyUsed();

        usedOfferIdHash[offerIdHash] = true;
        listing.offerIdHash = offerIdHash;
        listing.status = Status.OfferSent;

        emit OfferMarked(listingId, offerIdHash);
    }

    /// @notice Buyer fast path. Allowed in Funded (seller forgot to mark),
    ///         OfferSent, or ClaimPending. Irreversible.
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
