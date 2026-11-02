import SwiftUI

@main
struct SGUWorkspaceApp: App {
    @StateObject private var model = AppModel()
    var body: some Scene {
        WindowGroup {
            Group {
                if model.loggedIn { MainView() } else { LoginView() }
            }
            .environmentObject(model)
            .tint(Color(red: 1.0, green: 0.2, blue: 0.4)) // #FF3366 giống bản web
        }
    }
}
