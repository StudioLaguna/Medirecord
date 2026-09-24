import { StatusBar, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppRoot } from './src/ui';

function App(): React.JSX.Element {
  const systemScheme = useColorScheme();
  return (
    <SafeAreaProvider>
      <StatusBar
        barStyle={systemScheme === 'dark' ? 'light-content' : 'dark-content'}
      />
      <AppRoot systemScheme={systemScheme ?? 'light'} />
    </SafeAreaProvider>
  );
}

export default App;
