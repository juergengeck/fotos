import Foundation
import CoreBluetooth
import React

@objc(GATTPeripheralModule)
class GATTPeripheralModule: RCTEventEmitter, CBPeripheralManagerDelegate {

    private var peripheralManager: CBPeripheralManager?
    private var vgerService: CBMutableService?
    private var esp32Service: CBMutableService?

    // Characteristics
    private var messageTxCharacteristic: CBMutableCharacteristic?
    private var messageRxCharacteristic: CBMutableCharacteristic?
    private var deviceInfoCharacteristic: CBMutableCharacteristic?
    private var pairingRequestCharacteristic: CBMutableCharacteristic?
    private var pairingResponseCharacteristic: CBMutableCharacteristic?
    private var connectionStatusCharacteristic: CBMutableCharacteristic?

    // Message queue for reliable delivery
    private var messageQueue: [(Central: CBCentral, Data: Data)] = []
    private var subscribedCentrals: Set<CBCentral> = []

    // GATT UUIDs matching the TypeScript implementation
    private let VGER_SERVICE_UUID = CBUUID(string: "4fafc201-1fb5-459e-8fcc-c5c9c331914b")
    private let MESSAGE_TX_UUID = CBUUID(string: "beb5483e-36e1-4688-b7f5-ea07361b26a8")
    private let MESSAGE_RX_UUID = CBUUID(string: "beb5483f-36e1-4688-b7f5-ea07361b26a9")
    private let DEVICE_INFO_UUID = CBUUID(string: "beb54840-36e1-4688-b7f5-ea07361b26aa")
    private let PAIRING_REQUEST_UUID = CBUUID(string: "beb54841-36e1-4688-b7f5-ea07361b26ab")
    private let PAIRING_RESPONSE_UUID = CBUUID(string: "beb54842-36e1-4688-b7f5-ea07361b26ac")
    private let CONNECTION_STATUS_UUID = CBUUID(string: "beb54845-36e1-4688-b7f5-ea07361b26af")

    private let ESP32_SERVICE_UUID = CBUUID(string: "4fafc202-1fb5-459e-8fcc-c5c9c331914b")

    override init() {
        super.init()
    }

    @objc
    override static func requiresMainQueueSetup() -> Bool {
        return false
    }

    override func supportedEvents() -> [String]! {
        return [
            "onPeripheralStateChanged",
            "onCentralConnected",
            "onCentralDisconnected",
            "onCharacteristicRead",
            "onCharacteristicWritten",
            "onNotificationStateChanged",
            "onAdvertisingStarted",
            "onAdvertisingStopped",
            "onServiceAdded",
            "onError"
        ]
    }

    // MARK: - React Native Methods

    @objc
    func startPeripheral(_ deviceName: String,
                        resolver: @escaping RCTPromiseResolveBlock,
                        rejecter: @escaping RCTPromiseRejectBlock) {

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }

            if self.peripheralManager != nil {
                resolver(["status": "already_started"])
                return
            }

            // Initialize peripheral manager
            self.peripheralManager = CBPeripheralManager(
                delegate: self,
                queue: nil,
                options: [CBPeripheralManagerOptionShowPowerAlertKey: true]
            )

            resolver(["status": "initializing"])
        }
    }

    @objc
    func stopPeripheral(_ resolver: @escaping RCTPromiseResolveBlock,
                       rejecter: @escaping RCTPromiseRejectBlock) {

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }

            self.peripheralManager?.stopAdvertising()
            self.peripheralManager?.removeAllServices()
            self.peripheralManager = nil

            self.sendEvent(withName: "onAdvertisingStopped", body: [:])
            resolver(["status": "stopped"])
        }
    }

    @objc
    func sendNotification(_ centralId: String,
                         characteristicUuid: String,
                         data: String,
                         resolver: @escaping RCTPromiseResolveBlock,
                         rejecter: @escaping RCTPromiseRejectBlock) {

        guard let peripheralManager = peripheralManager else {
            rejecter("NOT_INITIALIZED", "Peripheral manager not initialized", nil)
            return
        }

        guard let dataToSend = Data(base64Encoded: data) else {
            rejecter("INVALID_DATA", "Invalid base64 data", nil)
            return
        }

        // Find the characteristic
        var characteristic: CBMutableCharacteristic?

        switch characteristicUuid.lowercased() {
        case MESSAGE_TX_UUID.uuidString.lowercased():
            characteristic = messageTxCharacteristic
        case MESSAGE_RX_UUID.uuidString.lowercased():
            characteristic = messageRxCharacteristic
        case PAIRING_RESPONSE_UUID.uuidString.lowercased():
            characteristic = pairingResponseCharacteristic
        case CONNECTION_STATUS_UUID.uuidString.lowercased():
            characteristic = connectionStatusCharacteristic
        default:
            rejecter("UNKNOWN_CHARACTERISTIC", "Unknown characteristic UUID", nil)
            return
        }

        guard let char = characteristic else {
            rejecter("CHARACTERISTIC_NOT_FOUND", "Characteristic not found", nil)
            return
        }

        // Send to all subscribed centrals or specific one
        let centralsToNotify = centralId == "all" ? Array(subscribedCentrals) : subscribedCentrals.filter { $0.identifier.uuidString == centralId }

        if centralsToNotify.isEmpty {
            rejecter("NO_SUBSCRIBERS", "No subscribed centrals found", nil)
            return
        }

        var success = true
        for central in centralsToNotify {
            let result = peripheralManager.updateValue(dataToSend, for: char, onSubscribedCentrals: [central])
            if !result {
                // Queue the data for later transmission
                messageQueue.append((central, dataToSend))
                success = false
            }
        }

        resolver(["status": success ? "sent" : "queued", "centrals": centralsToNotify.count])
    }

    @objc
    func updateCharacteristic(_ uuid: String,
                            value: String,
                            resolver: @escaping RCTPromiseResolveBlock,
                            rejecter: @escaping RCTPromiseRejectBlock) {

        guard let data = Data(base64Encoded: value) else {
            rejecter("INVALID_DATA", "Invalid base64 data", nil)
            return
        }

        // Update the appropriate characteristic value
        switch uuid.lowercased() {
        case DEVICE_INFO_UUID.uuidString.lowercased():
            deviceInfoCharacteristic?.value = data
        case CONNECTION_STATUS_UUID.uuidString.lowercased():
            connectionStatusCharacteristic?.value = data
        default:
            rejecter("UNKNOWN_CHARACTERISTIC", "Unknown characteristic UUID", nil)
            return
        }

        resolver(["status": "updated"])
    }

    // MARK: - CBPeripheralManagerDelegate

    func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
        var state = ""

        switch peripheral.state {
        case .unknown:
            state = "unknown"
        case .resetting:
            state = "resetting"
        case .unsupported:
            state = "unsupported"
        case .unauthorized:
            state = "unauthorized"
        case .poweredOff:
            state = "poweredOff"
        case .poweredOn:
            state = "poweredOn"
            setupServices()
        @unknown default:
            state = "unknown"
        }

        sendEvent(withName: "onPeripheralStateChanged", body: ["state": state])
    }

    private func setupServices() {
        guard let peripheralManager = peripheralManager else { return }

        // Create VGER service
        vgerService = CBMutableService(type: VGER_SERVICE_UUID, primary: true)

        // Create characteristics for app-to-app communication
        messageTxCharacteristic = CBMutableCharacteristic(
            type: MESSAGE_TX_UUID,
            properties: [.notify, .read],
            value: nil,
            permissions: [.readable]
        )

        messageRxCharacteristic = CBMutableCharacteristic(
            type: MESSAGE_RX_UUID,
            properties: [.write, .writeWithoutResponse],
            value: nil,
            permissions: [.writeable]
        )

        deviceInfoCharacteristic = CBMutableCharacteristic(
            type: DEVICE_INFO_UUID,
            properties: [.read],
            value: nil,
            permissions: [.readable]
        )

        pairingRequestCharacteristic = CBMutableCharacteristic(
            type: PAIRING_REQUEST_UUID,
            properties: [.write],
            value: nil,
            permissions: [.writeable]
        )

        pairingResponseCharacteristic = CBMutableCharacteristic(
            type: PAIRING_RESPONSE_UUID,
            properties: [.notify, .read],
            value: nil,
            permissions: [.readable]
        )

        connectionStatusCharacteristic = CBMutableCharacteristic(
            type: CONNECTION_STATUS_UUID,
            properties: [.read, .notify],
            value: nil,
            permissions: [.readable]
        )

        // Add characteristics to service
        vgerService?.characteristics = [
            messageTxCharacteristic!,
            messageRxCharacteristic!,
            deviceInfoCharacteristic!,
            pairingRequestCharacteristic!,
            pairingResponseCharacteristic!,
            connectionStatusCharacteristic!
        ]

        // Add service to peripheral manager
        peripheralManager.add(vgerService!)

        // Also add ESP32 compatibility service
        esp32Service = CBMutableService(type: ESP32_SERVICE_UUID, primary: false)
        peripheralManager.add(esp32Service!)
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
        if let error = error {
            sendEvent(withName: "onError", body: [
                "error": "service_add_failed",
                "message": error.localizedDescription
            ])
            return
        }

        sendEvent(withName: "onServiceAdded", body: ["service": service.uuid.uuidString])

        // Start advertising when all services are added
        if service.uuid == VGER_SERVICE_UUID {
            startAdvertising()
        }
    }

    private func startAdvertising() {
        guard let peripheralManager = peripheralManager else { return }

        let advertisementData: [String: Any] = [
            CBAdvertisementDataServiceUUIDsKey: [VGER_SERVICE_UUID, ESP32_SERVICE_UUID],
            CBAdvertisementDataLocalNameKey: "VGER_\(UUID().uuidString.prefix(6))"
        ]

        peripheralManager.startAdvertising(advertisementData)
    }

    func peripheralManagerDidStartAdvertising(_ peripheral: CBPeripheralManager, error: Error?) {
        if let error = error {
            sendEvent(withName: "onError", body: [
                "error": "advertising_failed",
                "message": error.localizedDescription
            ])
            return
        }

        sendEvent(withName: "onAdvertisingStarted", body: [:])
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didSubscribeTo characteristic: CBCharacteristic) {
        subscribedCentrals.insert(central)

        sendEvent(withName: "onNotificationStateChanged", body: [
            "central": central.identifier.uuidString,
            "characteristic": characteristic.uuid.uuidString,
            "subscribed": true
        ])

        // Send initial handshake when central subscribes
        if characteristic.uuid == MESSAGE_TX_UUID {
            sendHandshakeToCentral(central)
        }
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didUnsubscribeFrom characteristic: CBCharacteristic) {
        subscribedCentrals.remove(central)

        sendEvent(withName: "onNotificationStateChanged", body: [
            "central": central.identifier.uuidString,
            "characteristic": characteristic.uuid.uuidString,
            "subscribed": false
        ])
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
        for request in requests {
            if let value = request.value {
                handleWriteRequest(from: request.central, to: request.characteristic, value: value)
            }

            // Respond to write request
            peripheralManager.respond(to: request, withResult: .success)
        }
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveRead request: CBATTRequest) {
        // Handle read request based on characteristic
        switch request.characteristic.uuid {
        case DEVICE_INFO_UUID:
            if let data = deviceInfoCharacteristic?.value {
                request.value = data
            }
        case CONNECTION_STATUS_UUID:
            if let data = connectionStatusCharacteristic?.value {
                request.value = data
            }
        default:
            break
        }

        peripheralManager.respond(to: request, withResult: .success)

        sendEvent(withName: "onCharacteristicRead", body: [
            "central": request.central.identifier.uuidString,
            "characteristic": request.characteristic.uuid.uuidString
        ])
    }

    func peripheralManagerIsReady(toUpdateSubscribers peripheral: CBPeripheralManager) {
        // Send queued messages
        while !messageQueue.isEmpty {
            let (central, data) = messageQueue.removeFirst()

            if let characteristic = messageTxCharacteristic {
                let success = peripheral.updateValue(data, for: characteristic, onSubscribedCentrals: [central])

                if !success {
                    // Re-queue if still failing
                    messageQueue.insert((central, data), at: 0)
                    break
                }
            }
        }
    }

    // MARK: - Helper Methods

    private func handleWriteRequest(from central: CBCentral, to characteristic: CBCharacteristic, value: Data) {
        let base64Value = value.base64EncodedString()

        sendEvent(withName: "onCharacteristicWritten", body: [
            "central": central.identifier.uuidString,
            "characteristic": characteristic.uuid.uuidString,
            "value": base64Value
        ])

        // Handle specific characteristic writes
        switch characteristic.uuid {
        case MESSAGE_RX_UUID:
            // Handle incoming message
            handleIncomingMessage(from: central, data: value)
        case PAIRING_REQUEST_UUID:
            // Handle pairing request
            handlePairingRequest(from: central, data: value)
        default:
            break
        }
    }

    private func handleIncomingMessage(from central: CBCentral, data: Data) {
        // Process the message and potentially send a response
        // This would be handled by the JavaScript layer via events
    }

    private func handlePairingRequest(from central: CBCentral, data: Data) {
        // Process pairing request and send response
        // This would be handled by the JavaScript layer via events
    }

    private func sendHandshakeToCentral(_ central: CBCentral) {
        let handshake: [String: Any] = [
            "type": "VGER_APP_PERIPHERAL",
            "version": "1.0.0",
            "timestamp": Date().timeIntervalSince1970
        ]

        if let jsonData = try? JSONSerialization.data(withJSONObject: handshake),
           let characteristic = messageTxCharacteristic {
            peripheralManager?.updateValue(jsonData, for: characteristic, onSubscribedCentrals: [central])
        }
    }
}

// MARK: - React Native Module Export

@objc(GATTPeripheralModule)
extension GATTPeripheralModule: RCTBridgeModule {
    static func moduleName() -> String! {
        return "GATTPeripheralModule"
    }
}
