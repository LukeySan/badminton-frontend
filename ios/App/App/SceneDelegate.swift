import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = MainViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

/// Phones are portrait-only (CLAUDE.md), except the player's own full screen, which
/// asks for landscape with @capacitor/screen-orientation. Info.plist allows landscape
/// so that lock can rotate the app; this starts it in portrait before the page loads,
/// and the plugin's unlock() comes back here (portrait), not to Info.plist's list.
/// iPads keep every orientation (multitasking can't be locked anyway).
class MainViewController: CAPBridgeViewController {
    override func setScreenOrientationDefaults() {
        if UIDevice.current.userInterfaceIdiom == .phone {
            supportedOrientations = [UIInterfaceOrientation.portrait.rawValue]
        } else {
            super.setScreenOrientationDefaults()
        }
    }
}
